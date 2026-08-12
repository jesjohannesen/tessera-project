// The matcher: candidate generation (blocking) + scoring. Blocking uses
// pg_trgm name similarity; scoring adds alias overlap and exact-match
// boosts/penalties on discriminating properties. High scores auto-resolve,
// mid scores queue for human review, low scores are dropped.

import { getPool } from "@/db/client";
import { getOntology, requireType } from "@/ontology/metadata";
import { resolveObjects } from "./resolutions";

export const AUTO_THRESHOLD = 0.93;
export const REVIEW_THRESHOLD = 0.62;

interface MatchSpec {
  nameProp: string;
  aliasProp?: string;
  // Exact-equality boosts; a present-but-different hard value penalizes.
  boosts: { prop: string; weight: number; penalty?: number }[];
}

export const MATCH_SPECS: Record<string, MatchSpec> = {
  person: {
    nameProp: "name",
    aliasProp: "aliases",
    boosts: [
      { prop: "birth_date", weight: 0.25, penalty: 0.35 },
      { prop: "nationality", weight: 0.05, penalty: 0.05 },
    ],
  },
  organization: {
    nameProp: "name",
    boosts: [
      { prop: "lei", weight: 0.5, penalty: 0.5 },
      { prop: "jurisdiction", weight: 0.05, penalty: 0.05 },
    ],
  },
  vessel: {
    nameProp: "name",
    boosts: [
      { prop: "mmsi", weight: 0.5, penalty: 0.5 },
      { prop: "flag", weight: 0.03, penalty: 0.03 },
    ],
  },
};

export interface MatcherRunResult {
  type: string;
  pairsScored: number;
  autoResolved: number;
  queued: number;
  skipped: number;
}

function normName(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function aliasSet(props: Record<string, unknown>, spec: MatchSpec): Set<string> {
  const out = new Set<string>();
  if (spec.aliasProp && Array.isArray(props[spec.aliasProp])) {
    for (const a of props[spec.aliasProp] as unknown[]) {
      const n = normName(a);
      if (n) out.add(n);
    }
  }
  return out;
}

export function scorePair(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  nameSim: number,
  spec: MatchSpec
): { score: number; features: Record<string, unknown> } {
  const features: Record<string, unknown> = { name_sim: Math.round(nameSim * 1000) / 1000 };
  let score = 0.75 * nameSim;

  const aliasesA = aliasSet(a, spec);
  const aliasesB = aliasSet(b, spec);
  const nameA = normName(a[spec.nameProp]);
  const nameB = normName(b[spec.nameProp]);
  const aliasHit =
    aliasesA.has(nameB) ||
    aliasesB.has(nameA) ||
    [...aliasesA].some((x) => aliasesB.has(x));
  if (aliasHit) {
    score += 0.1;
    features.alias_overlap = true;
  }

  for (const boost of spec.boosts) {
    const va = a[boost.prop];
    const vb = b[boost.prop];
    if (va == null || vb == null) continue;
    if (String(va).toLowerCase() === String(vb).toLowerCase()) {
      score += boost.weight;
      features[`${boost.prop}_match`] = true;
    } else if (boost.penalty) {
      score -= boost.penalty;
      features[`${boost.prop}_conflict`] = true;
    }
  }

  return { score: Math.max(0, Math.min(1, score)), features };
}

export async function runMatcher(typeApiName?: string, actor = "matcher"): Promise<MatcherRunResult[]> {
  const meta = await getOntology();
  const pool = getPool();
  const types = typeApiName ? [typeApiName] : Object.keys(MATCH_SPECS);
  const results: MatcherRunResult[] = [];

  for (const typeName of types) {
    const spec = MATCH_SPECS[typeName];
    if (!spec) continue;
    const type = requireType(meta, typeName);

    // Blocking: candidate pairs by trigram-similar names, excluding pairs
    // already co-resolved in an active bag or already decided.
    const pairs = (
      await pool.query(
        `select a.id as id_a, b.id as id_b, a.props as props_a, b.props as props_b,
                similarity(lower(a.props->>'${spec.nameProp}'), lower(b.props->>'${spec.nameProp}')) as name_sim
         from obj a
         join obj b on b.object_type_id = a.object_type_id and a.id < b.id
           and lower(a.props->>'${spec.nameProp}') % lower(b.props->>'${spec.nameProp}')
         where a.object_type_id = $1 and not a.deleted and not b.deleted
           and not exists (
             select 1 from resolution_member ma
             join resolution_member mb on mb.resolution_id = ma.resolution_id
             join resolution r on r.id = ma.resolution_id and r.status = 'active'
             where ma.obj_id = a.id and mb.obj_id = b.id
           )
           and not exists (
             select 1 from resolution_candidate c
             where (c.obj_a = a.id and c.obj_b = b.id) or (c.obj_a = b.id and c.obj_b = a.id)
           )`,
        [type.id]
      )
    ).rows;

    let autoResolved = 0;
    let queued = 0;
    let skipped = 0;

    for (const pair of pairs) {
      const { score, features } = scorePair(
        pair.props_a,
        pair.props_b,
        Number(pair.name_sim),
        spec
      );
      if (score >= AUTO_THRESHOLD) {
        await pool.query(
          `insert into resolution_candidate (object_type_id, obj_a, obj_b, score, features, status, decided_by, decided_at)
           values ($1, $2, $3, $4, $5, 'auto', $6, now()) on conflict (obj_a, obj_b) do nothing`,
          [type.id, pair.id_a, pair.id_b, score, JSON.stringify(features), actor]
        );
        await resolveObjects([pair.id_a, pair.id_b], {
          method: `auto:${typeName}-match`,
          confidence: score,
          actor,
        });
        autoResolved++;
      } else if (score >= REVIEW_THRESHOLD) {
        await pool.query(
          `insert into resolution_candidate (object_type_id, obj_a, obj_b, score, features)
           values ($1, $2, $3, $4, $5) on conflict (obj_a, obj_b) do nothing`,
          [type.id, pair.id_a, pair.id_b, score, JSON.stringify(features)]
        );
        queued++;
      } else {
        skipped++;
      }
    }

    await pool.query(
      `insert into audit_log (actor, category, detail) values ($1, 'matcherRun', $2)`,
      [actor, JSON.stringify({ type: typeName, pairsScored: pairs.length, autoResolved, queued, skipped })]
    );
    results.push({ type: typeName, pairsScored: pairs.length, autoResolved, queued, skipped });
  }
  return results;
}

export async function decideCandidate(
  candidateId: number,
  decision: "accepted" | "rejected",
  actor: string
): Promise<{ canonicalKey?: string }> {
  const pool = getPool();
  const res = await pool.query(
    `update resolution_candidate set status = $2, decided_by = $3, decided_at = now()
     where id = $1 and status = 'pending' returning obj_a, obj_b, score`,
    [candidateId, decision, actor]
  );
  if (!res.rows.length) throw new Error(`Candidate ${candidateId} is not pending`);
  await pool.query(
    `insert into audit_log (actor, category, detail) values ($1, $2, $3)`,
    [actor, decision === "accepted" ? "resolutionAccepted" : "resolutionRejected", JSON.stringify({ candidateId })]
  );
  if (decision === "rejected") return {};
  const row = res.rows[0];
  const { canonicalKey } = await resolveObjects([row.obj_a, row.obj_b], {
    method: "review",
    confidence: Number(row.score),
    actor,
  });
  return { canonicalKey };
}
