import Link from "next/link";
import { getOntology, requireType } from "@/ontology/metadata";
import { aggregateObjectSet, loadObjectSet } from "@/ontology/objectSet";
import { Filter, ObjectSetAST } from "@/ontology/types";
import { FACET_CONFIG } from "@/explore/facets";

export const dynamic = "force-dynamic";

function buildQuery(base: Record<string, string>, changes: Record<string, string | null>): string {
  const params = new URLSearchParams(base);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  return `/explore?${params.toString()}`;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") flat[k] = v;

  const meta = await getOntology();
  const typeName = flat.type && meta.types.some((t) => t.apiName === flat.type) ? flat.type : "person";
  const type = requireType(meta, typeName);
  const facetProps = FACET_CONFIG[typeName] ?? [];

  // Active filters: any query param matching a searchable property of this type.
  const activeFilters: { prop: string; value: string }[] = [];
  for (const [k, v] of Object.entries(flat)) {
    if (k === "type") continue;
    if (type.properties.some((p) => p.apiName === k && (p.searchable || p.apiName === type.pkProperty)))
      activeFilters.push({ prop: k, value: v });
  }

  const filterClause: Filter | undefined = activeFilters.length
    ? { op: "and", clauses: activeFilters.map((f) => ({ op: "eq", property: f.prop, value: f.value }) as Filter) }
    : undefined;
  const objectSet: ObjectSetAST = { type: typeName, filter: filterClause };

  const [results, ...facetResults] = await Promise.all([
    loadObjectSet(objectSet, { pageSize: 60 }),
    ...facetProps.map((prop) =>
      aggregateObjectSet(objectSet, { groupBy: { property: prop }, metrics: [{ fn: "count" }] })
    ),
  ]);

  const columns = type.properties
    .filter((p) => p.apiName !== type.pkProperty)
    .slice(0, 5);

  return (
    <main>
      <h1>Object Explorer</h1>
      <p className="sub">
        Filter an object set, pivot on facets, drill into any object. Facets recompute against the
        current filters.
      </p>

      <div className="active-filters">
        {meta.types.map((t) => (
          <Link
            key={t.apiName}
            className="filter-pill"
            href={`/explore?type=${t.apiName}`}
            style={
              t.apiName === typeName
                ? { background: "var(--accent)", color: "var(--surface)" }
                : { borderColor: "var(--line)", color: "var(--muted)" }
            }
          >
            {t.displayName}
          </Link>
        ))}
      </div>

      {activeFilters.length > 0 && (
        <div className="active-filters">
          {activeFilters.map((f) => (
            <Link key={f.prop} className="filter-pill" href={buildQuery(flat, { [f.prop]: null })}>
              {f.prop}: {f.value} <span className="x">×</span>
            </Link>
          ))}
        </div>
      )}

      <div className="explore-grid">
        <div>
          {facetProps.map((prop, i) => {
            const groups = facetResults[i].groups
              .filter((g) => g.group_key != null)
              .slice(0, 8);
            const max = Math.max(1, ...groups.map((g) => Number(g.count)));
            const propLabel = type.properties.find((p) => p.apiName === prop)?.displayName ?? prop;
            if (!groups.length) return null;
            return (
              <div className="facet" key={prop}>
                <h3>{propLabel}</h3>
                {groups.map((g) => {
                  const value = String(g.group_key);
                  const isActive = flat[prop] === value;
                  return (
                    <Link
                      key={value}
                      className="facet-row"
                      aria-pressed={isActive}
                      href={buildQuery(flat, { [prop]: isActive ? null : value })}
                    >
                      <span
                        className="bar"
                        style={{ width: `${(Number(g.count) / max) * 100}%` }}
                      />
                      <span className="label">{value}</span>
                      <span className="cnt">{Number(g.count)}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div>
          <p className="section-note">
            {results.totalCount} {type.displayName.toLowerCase()} object
            {results.totalCount === 1 ? "" : "s"}
            {results.totalCount > results.objects.length ? ` (showing ${results.objects.length})` : ""}
          </p>
          <div className="panel tablewrap">
            <table>
              <thead>
                <tr>
                  <th>{type.pkProperty}</th>
                  {columns.map((c) => (
                    <th key={c.apiName}>{c.displayName}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.objects.map((o) => (
                  <tr key={o.pk}>
                    <td>
                      <Link className="rowlink" href={`/object/${typeName}/${encodeURIComponent(o.pk)}`}>
                        {o.title ?? o.pk}
                      </Link>
                    </td>
                    {columns.map((c) => {
                      const v = o.props[c.apiName];
                      return (
                        <td key={c.apiName} className={["integer", "double"].includes(c.type) ? "num" : undefined}>
                          {v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!results.objects.length && (
                  <tr>
                    <td colSpan={columns.length + 1} className="empty">
                      No matching objects.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
