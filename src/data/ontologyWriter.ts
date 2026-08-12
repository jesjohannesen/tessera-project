// Ontology writer: the lean Funnel. Upserts transform output into the
// instance plane — ONLY source_props. edit_props belongs to actions, so
// analyst edits always survive re-ingestion (the overlay contract).

import { PoolClient } from "pg";
import { getPool } from "@/db/client";
import { getOntology, resolveLink } from "@/ontology/metadata";

export interface ObjectOut {
  kind: "object";
  type: string;
  pk: string;
  props: Record<string, unknown>;
}

export interface LinkOut {
  kind: "link";
  link: string; // link api name (either direction)
  aPk: string;
  bPk: string;
}

export type OntologyOut = ObjectOut | LinkOut;

export interface UpsertStats {
  objects: number;
  links: number;
  skippedLinks: number;
}

export async function writeToOntology(
  outputs: OntologyOut[],
  actor: string,
  sourceRef?: string
): Promise<UpsertStats> {
  const meta = await getOntology();
  const pool = getPool();
  const client = await pool.connect();
  const stats: UpsertStats = { objects: 0, links: 0, skippedLinks: 0 };
  try {
    await client.query("begin");

    const objects = outputs.filter((o): o is ObjectOut => o.kind === "object");
    for (const o of objects) {
      const type = meta.types.find((t) => t.apiName === o.type);
      if (!type) throw new Error(`Unknown object type in transform output: ${o.type}`);
      const known = new Set(type.properties.map((p) => p.apiName));
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o.props)) {
        if (known.has(k) && v !== undefined && v !== null && v !== "") props[k] = v;
      }
      props[type.pkProperty] = o.pk;
      const prevRow = await client.query(
        `select source_props from obj where object_type_id = $1 and pk_value = $2`,
        [type.id, o.pk]
      );
      const prev: Record<string, unknown> = prevRow.rows[0]?.source_props ?? {};
      const upserted = await client.query(
        `insert into obj (object_type_id, pk_value, source_props) values ($1, $2, $3)
         on conflict (object_type_id, pk_value)
         do update set source_props = obj.source_props || excluded.source_props, updated_at = now()
         returning id`,
        [type.id, o.pk, JSON.stringify(props)]
      );
      // Card stack: one provenance row per property whose value actually changed.
      const changed = Object.entries(props).filter(
        ([k, v]) => JSON.stringify(prev[k]) !== JSON.stringify(v)
      );
      if (changed.length) {
        const values: string[] = [];
        const params: unknown[] = [];
        for (const [prop, v] of changed) {
          params.push(upserted.rows[0].id, prop, JSON.stringify(v), actor, sourceRef ?? null);
          const n = params.length;
          values.push(`($${n - 4}, $${n - 3}, $${n - 2}, 'source', $${n - 1}, $${n})`);
        }
        await client.query(
          `insert into prop_provenance (obj_id, property, value, origin, writer, source_ref) values ${values.join(", ")}`,
          params
        );
      }
      stats.objects++;
    }

    const links = outputs.filter((o): o is LinkOut => o.kind === "link");
    for (const l of links) {
      const { link, from } = resolveLink(meta, l.link);
      const typeOfA = from === "a" ? link.objectTypeA : link.objectTypeB;
      const typeOfB = from === "a" ? link.objectTypeB : link.objectTypeA;
      const idA = await lookupObj(client, meta, typeOfA, l.aPk);
      const idB = await lookupObj(client, meta, typeOfB, l.bPk);
      if (!idA || !idB) {
        stats.skippedLinks++;
        continue;
      }
      const [objA, objB] = from === "a" ? [idA, idB] : [idB, idA];
      await client.query(
        `insert into link_instance (link_type_id, obj_a, obj_b, from_edit) values ($1, $2, $3, false)
         on conflict do nothing`,
        [link.id, objA, objB]
      );
      stats.links++;
    }

    if (stats.objects || stats.links) {
      await client.query(
        `insert into audit_log (actor, category, detail) values ($1, 'dataLoad', $2)`,
        [actor, JSON.stringify(stats)]
      );
    }
    await client.query("commit");
    return stats;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function lookupObj(
  client: PoolClient,
  meta: Awaited<ReturnType<typeof getOntology>>,
  typeApi: string,
  pk: string
): Promise<string | null> {
  const type = meta.types.find((t) => t.apiName === typeApi);
  if (!type) return null;
  const res = await client.query(
    `select id from obj where object_type_id = $1 and pk_value = $2 and not deleted`,
    [type.id, pk]
  );
  return res.rows.length ? res.rows[0].id : null;
}
