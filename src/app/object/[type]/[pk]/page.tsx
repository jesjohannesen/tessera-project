import Link from "next/link";
import { getOntology, requireType } from "@/ontology/metadata";
import { getObject, listLinked } from "@/ontology/objectSet";

export const dynamic = "force-dynamic";

export default async function ObjectPage({
  params,
}: {
  params: Promise<{ type: string; pk: string }>;
}) {
  const { type, pk: rawPk } = await params;
  const pk = decodeURIComponent(rawPk);
  const meta = await getOntology();
  const typeMeta = requireType(meta, type);
  const obj = await getObject(type, pk);

  // Every link this type participates in, with its outbound traversal name.
  const outboundLinks = meta.links.flatMap((l) => {
    const out = [];
    if (l.objectTypeA === type)
      out.push({ traverse: l.apiNameAToB, display: l.displayName, target: l.objectTypeB });
    if (l.objectTypeB === type)
      out.push({ traverse: l.apiNameBToA, display: l.displayName, target: l.objectTypeA });
    return out;
  });

  const linked = await Promise.all(
    outboundLinks.map(async (l) => ({
      ...l,
      objects: (await listLinked(type, pk, l.traverse)).objects,
    }))
  );

  return (
    <main>
      <p className="mono">
        <Link href={`/browse/${type}`}>{typeMeta.displayName}</Link>
      </p>
      <h1>{obj.title ?? pk}</h1>
      <p className="sub">
        <code className="inline">{pk}</code> · version {obj.version}
      </p>

      <h2>Properties</h2>
      <p className="section-note">
        Origin shows the overlay: <span className="chip source">source</span> values come from
        ingested data, <span className="chip edit">edit</span> values were written by actions and
        take precedence.
      </p>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {typeMeta.properties.map((p) => {
              const v = (obj.props as Record<string, unknown>)[p.apiName];
              if (v === undefined || v === null) return null;
              const edited = (obj.editProps as Record<string, unknown>)[p.apiName] !== undefined;
              return (
                <tr key={p.apiName}>
                  <td>{p.displayName}</td>
                  <td>{Array.isArray(v) ? v.join(", ") : String(v)}</td>
                  <td>
                    <span className={`chip ${edited ? "edit" : "source"}`}>
                      {edited ? "edit" : "source"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Linked objects</h2>
      {linked
        .filter((l) => l.objects.length)
        .map((l) => (
          <div key={l.traverse}>
            <p className="section-note">
              {l.display} · <code className="inline">{l.traverse}</code> → {l.target}
            </p>
            <div className="panel tablewrap" style={{ marginBottom: "1rem" }}>
              <table>
                <tbody>
                  {l.objects.map((o) => (
                    <tr key={`${l.traverse}-${o.pk}`}>
                      <td style={{ width: "10rem" }}>
                        <Link className="rowlink" href={`/object/${l.target}/${encodeURIComponent(o.pk)}`}>
                          {o.pk}
                        </Link>
                      </td>
                      <td>{o.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      {!linked.some((l) => l.objects.length) && <p className="empty">No linked objects.</p>}
    </main>
  );
}
