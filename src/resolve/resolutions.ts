// Resolution bags: N objects of one type presented as a single canonical
// entity. Non-destructive — constituents keep their own props and history;
// reads flatten members with per-property attribution; unresolve dissolves
// the bag and the objects stand alone again.

import { randomBytes } from "node:crypto";
import { getPool } from "@/db/client";
import { getOntology, requireType } from "@/ontology/metadata";
import { ApiError } from "@/ontology/types";

export interface ResolutionSummary {
  id: string;
  canonicalKey: string;
  type: string;
  status: string;
  method: string;
  confidence: number | null;
  createdBy: string;
  createdAt: string;
  memberCount: number;
  title: string | null;
}

export interface MergedProperty {
  property: string;
  value: unknown;
  fromPk: string;
  conflicts?: { pk: string; value: unknown }[];
}

/**
 * Create a resolution over the given objects, or extend/merge existing ones:
 * if any member already belongs to an active resolution, everything is folded
 * into the oldest such bag (transitive merge) and the others are dissolved.
 */
export async function resolveObjects(
  objIds: string[],
  opts: { method: string; confidence?: number; actor: string }
): Promise<{ resolutionId: string; canonicalKey: string; merged: number }> {
  if (objIds.length < 2 && !(await anyActiveResolution(objIds)))
    throw new ApiError(400, "A resolution needs at least two objects");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");

    const typeRows = await client.query(
      `select distinct object_type_id from obj where id = any($1)`,
      [objIds]
    );
    if (typeRows.rows.length !== 1)
      throw new ApiError(400, "All members of a resolution must share one object type");
    const objectTypeId = typeRows.rows[0].object_type_id;

    const existing = await client.query(
      `select distinct r.id, r.created_at from resolution r
       join resolution_member m on m.resolution_id = r.id
       where r.status = 'active' and m.obj_id = any($1)
       order by r.created_at`,
      [objIds]
    );

    let resolutionId: string;
    let canonicalKey: string;
    let mergedBags = 0;

    if (existing.rows.length) {
      resolutionId = existing.rows[0].id;
      // Fold members of any other active bags into the oldest one.
      for (const other of existing.rows.slice(1)) {
        await client.query(
          `insert into resolution_member (resolution_id, obj_id)
           select $1, obj_id from resolution_member where resolution_id = $2
           on conflict do nothing`,
          [resolutionId, other.id]
        );
        await client.query(
          `update resolution set status = 'dissolved', dissolved_at = now(), dissolved_by = $2 where id = $1`,
          [other.id, `merge:${opts.actor}`]
        );
        mergedBags++;
      }
      canonicalKey = (
        await client.query(`select canonical_key from resolution where id = $1`, [resolutionId])
      ).rows[0].canonical_key;
    } else {
      canonicalKey = `R-${randomBytes(4).toString("hex")}`;
      const created = await client.query(
        `insert into resolution (object_type_id, canonical_key, method, confidence, created_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [objectTypeId, canonicalKey, opts.method, opts.confidence ?? null, opts.actor]
      );
      resolutionId = created.rows[0].id;
    }

    for (const objId of objIds) {
      await client.query(
        `insert into resolution_member (resolution_id, obj_id) values ($1, $2) on conflict do nothing`,
        [resolutionId, objId]
      );
    }

    // Hygiene: any still-pending candidate whose pair is now co-resolved is
    // settled by this merge — close it so the queue only holds open questions.
    await client.query(
      `update resolution_candidate c
       set status = 'accepted', decided_by = $1, decided_at = now()
       where c.status = 'pending' and exists (
         select 1 from resolution_member ma
         join resolution_member mb on mb.resolution_id = ma.resolution_id
         join resolution r on r.id = ma.resolution_id and r.status = 'active'
         where ma.obj_id = c.obj_a and mb.obj_id = c.obj_b
       )`,
      [`auto-close:${opts.actor}`]
    );

    await client.query(
      `insert into audit_log (actor, category, detail) values ($1, 'resolutionCreated', $2)`,
      [
        opts.actor,
        JSON.stringify({ resolutionId, canonicalKey, members: objIds.length, method: opts.method, mergedBags }),
      ]
    );
    await client.query("commit");
    return { resolutionId, canonicalKey, merged: mergedBags };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function anyActiveResolution(objIds: string[]): Promise<boolean> {
  const res = await getPool().query(
    `select 1 from resolution_member m join resolution r on r.id = m.resolution_id
     where r.status = 'active' and m.obj_id = any($1) limit 1`,
    [objIds]
  );
  return res.rows.length > 0;
}

export async function unresolve(canonicalKey: string, actor: string): Promise<void> {
  const pool = getPool();
  const res = await pool.query(
    `update resolution set status = 'dissolved', dissolved_at = now(), dissolved_by = $2
     where canonical_key = $1 and status = 'active' returning id`,
    [canonicalKey, actor]
  );
  if (!res.rows.length) throw new ApiError(404, `No active resolution ${canonicalKey}`);
  await pool.query(
    `insert into audit_log (actor, category, detail) values ($1, 'unresolve', $2)`,
    [actor, JSON.stringify({ canonicalKey })]
  );
}

export async function listResolutions(
  status: "active" | "dissolved" = "active"
): Promise<ResolutionSummary[]> {
  const meta = await getOntology();
  const rows = (
    await getPool().query(
      `select r.*, count(m.obj_id)::int as member_count,
              (select o.props->>ot.title_property from resolution_member m2
               join obj o on o.id = m2.obj_id
               where m2.resolution_id = r.id order by m2.added_at, o.pk_value limit 1) as title
       from resolution r
       join object_type ot on ot.id = r.object_type_id
       left join resolution_member m on m.resolution_id = r.id
       where r.status = $1
       group by r.id, ot.title_property
       order by r.created_at desc`,
      [status]
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    canonicalKey: r.canonical_key,
    type: meta.types.find((t) => t.id === r.object_type_id)?.apiName ?? "?",
    status: r.status,
    method: r.method,
    confidence: r.confidence,
    createdBy: r.created_by,
    createdAt: r.created_at,
    memberCount: r.member_count,
    title: r.title,
  }));
}

export interface ResolvedEntity {
  canonicalKey: string;
  type: string;
  status: string;
  method: string;
  confidence: number | null;
  title: string | null;
  members: { pk: string; title: string | null; props: Record<string, unknown> }[];
  merged: MergedProperty[];
}

/** Flattened read: first non-null value per property in member order, with
 *  attribution and any conflicting values from other members. */
export async function getResolvedEntity(canonicalKey: string): Promise<ResolvedEntity> {
  const meta = await getOntology();
  const pool = getPool();
  const rRes = await pool.query(`select * from resolution where canonical_key = $1`, [canonicalKey]);
  if (!rRes.rows.length) throw new ApiError(404, `Unknown resolution ${canonicalKey}`);
  const r = rRes.rows[0];
  const type = meta.types.find((t) => t.id === r.object_type_id);
  if (!type) throw new ApiError(500, "Resolution references unknown type");

  const members = (
    await pool.query(
      `select o.pk_value, o.props from resolution_member m
       join obj o on o.id = m.obj_id
       where m.resolution_id = $1 and not o.deleted
       order by m.added_at, o.pk_value`,
      [r.id]
    )
  ).rows.map((row) => ({
    pk: row.pk_value,
    title: (row.props?.[type.titleProperty] as string) ?? null,
    props: row.props as Record<string, unknown>,
  }));

  const merged: MergedProperty[] = [];
  for (const p of type.properties) {
    const holders = members
      .filter((m) => m.props[p.apiName] !== undefined && m.props[p.apiName] !== null)
      .map((m) => ({ pk: m.pk, value: m.props[p.apiName] }));
    if (!holders.length) continue;
    const [first, ...rest] = holders;
    const conflicts = rest.filter(
      (h) => JSON.stringify(h.value) !== JSON.stringify(first.value)
    );
    merged.push({
      property: p.apiName,
      value: first.value,
      fromPk: first.pk,
      conflicts: conflicts.length ? conflicts : undefined,
    });
  }

  return {
    canonicalKey,
    type: type.apiName,
    status: r.status,
    method: r.method,
    confidence: r.confidence,
    title: members[0]?.title ?? null,
    members,
    merged,
  };
}

/** The active resolution (if any) that an object belongs to. */
export async function resolutionForObject(
  typeApiName: string,
  pk: string
): Promise<{ canonicalKey: string; memberCount: number } | null> {
  const meta = await getOntology();
  const type = requireType(meta, typeApiName);
  const res = await getPool().query(
    `select r.canonical_key,
            (select count(*)::int from resolution_member where resolution_id = r.id) as member_count
     from resolution r
     join resolution_member m on m.resolution_id = r.id
     join obj o on o.id = m.obj_id
     where r.status = 'active' and o.object_type_id = $1 and o.pk_value = $2
     limit 1`,
    [type.id, pk]
  );
  return res.rows.length
    ? { canonicalKey: res.rows[0].canonical_key, memberCount: res.rows[0].member_count }
    : null;
}
