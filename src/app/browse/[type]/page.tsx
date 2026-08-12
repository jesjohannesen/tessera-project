import Link from "next/link";
import { getOntology, requireType } from "@/ontology/metadata";
import { loadObjectSet } from "@/ontology/objectSet";

export const dynamic = "force-dynamic";

export default async function BrowseType({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const meta = await getOntology();
  const typeMeta = requireType(meta, type);
  const result = await loadObjectSet({ type }, { pageSize: 100 });

  const columns = typeMeta.properties
    .filter((p) => p.apiName !== typeMeta.pkProperty)
    .slice(0, 5);

  return (
    <main>
      <h1>{typeMeta.displayName}</h1>
      <p className="sub">
        <span className="mono">{typeMeta.kind}</span> · {result.totalCount} objects ·
        primary key <code className="inline">{typeMeta.pkProperty}</code>
      </p>

      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>{typeMeta.pkProperty}</th>
              {columns.map((c) => (
                <th key={c.apiName}>{c.displayName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.objects.map((o) => (
              <tr key={o.pk}>
                <td>
                  <Link className="rowlink" href={`/object/${type}/${encodeURIComponent(o.pk)}`}>
                    {o.pk}
                  </Link>
                </td>
                {columns.map((c) => {
                  const v = o.props[c.apiName];
                  return (
                    <td key={c.apiName} className={c.type === "integer" || c.type === "double" ? "num" : undefined}>
                      {v === undefined || v === null
                        ? ""
                        : Array.isArray(v)
                          ? v.join(", ")
                          : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!result.objects.length && (
              <tr>
                <td colSpan={columns.length + 1} className="empty">
                  No objects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
