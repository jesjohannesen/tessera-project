// Global search: full-text-ish match across each type's searchable string
// properties plus the title property, using ILIKE. One query bar over the
// whole ontology, grouped by type.

import { getPool } from "@/db/client";
import { getOntology } from "@/ontology/metadata";

export interface SearchHit {
  type: string;
  typeLabel: string;
  pk: string;
  title: string | null;
  matchedOn: string;
  snippet: string | null;
}

export interface SearchGroup {
  type: string;
  typeLabel: string;
  hits: SearchHit[];
  total: number;
}

export async function searchObjects(q: string, perType = 8): Promise<SearchGroup[]> {
  const query = q.trim();
  if (!query) return [];
  const meta = await getOntology();
  const pool = getPool();
  const groups: SearchGroup[] = [];

  for (const type of meta.types) {
    // Searchable text-bearing properties, plus title and pk, deduped.
    const props = new Set<string>([type.titleProperty]);
    for (const p of type.properties) {
      if ((p.searchable || p.apiName === type.pkProperty) && ["string", "string_array"].includes(p.type))
        props.add(p.apiName);
    }
    const propList = [...props];
    const ors = propList.map((p) => `o.props->>'${p}' ilike $2`).join(" or ");

    const res = await pool.query(
      `select o.pk_value, o.props,
              count(*) over () as total
       from obj o
       where o.object_type_id = $1 and not o.deleted and (${ors})
       order by (o.props->>'${type.titleProperty}' ilike $2) desc, o.pk_value
       limit ${perType}`,
      [type.id, `%${query}%`]
    );
    if (!res.rows.length) continue;

    const hits: SearchHit[] = res.rows.map((r) => {
      const p = r.props as Record<string, unknown>;
      // Which property actually matched (for the "matched on" hint).
      const needle = query.toLowerCase();
      const matchedProp =
        propList.find((prop) => String(p[prop] ?? "").toLowerCase().includes(needle)) ??
        type.titleProperty;
      const snippetSource = p["text"] ?? p["summary"] ?? p["snippet"] ?? p[matchedProp];
      return {
        type: type.apiName,
        typeLabel: type.displayName,
        pk: r.pk_value,
        title: (p[type.titleProperty] as string) ?? null,
        matchedOn: matchedProp,
        snippet: snippetSource ? String(snippetSource).slice(0, 200) : null,
      };
    });

    groups.push({
      type: type.apiName,
      typeLabel: type.displayName,
      hits,
      total: Number(res.rows[0].total),
    });
  }

  groups.sort((a, b) => b.total - a.total);
  return groups;
}
