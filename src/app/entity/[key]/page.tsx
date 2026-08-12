import Link from "next/link";
import { getResolvedEntity } from "@/resolve/resolutions";
import { PostButton } from "@/app/components/PostButton";

export const dynamic = "force-dynamic";

export default async function EntityPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const entity = await getResolvedEntity(key);

  return (
    <main>
      <p className="mono">
        <Link href="/resolve">Entity resolution</Link>
      </p>
      <h1>{entity.title ?? entity.canonicalKey}</h1>
      <p className="sub">
        <code className="inline">{entity.canonicalKey}</code> · resolved {entity.type} ·{" "}
        {entity.members.length} constituents · {entity.method}
        {entity.confidence != null ? ` · confidence ${Number(entity.confidence).toFixed(2)}` : ""}
        {entity.status === "dissolved" ? " · DISSOLVED" : ""}
      </p>

      {entity.status === "active" && (
        <div style={{ marginBottom: "1.2rem" }}>
          <PostButton
            url={`/api/resolve/resolutions/${entity.canonicalKey}/unresolve`}
            label="Unmerge"
          />
        </div>
      )}

      <h2>Merged view</h2>
      <p className="section-note">
        First non-null value per property in member order; every value is attributed to the
        constituent that supplied it. Conflicting values from other members are preserved.
      </p>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
              <th>From</th>
              <th>Conflicts</th>
            </tr>
          </thead>
          <tbody>
            {entity.merged.map((m) => (
              <tr key={m.property}>
                <td>{m.property}</td>
                <td>{Array.isArray(m.value) ? m.value.join(", ") : String(m.value)}</td>
                <td>
                  <span className="chip source">{m.fromPk}</span>
                </td>
                <td>
                  {m.conflicts?.map((conflict) => (
                    <div key={conflict.pk} className="section-note" style={{ margin: 0 }}>
                      <span className="chip edit">{conflict.pk}</span>{" "}
                      {Array.isArray(conflict.value) ? conflict.value.join(", ") : String(conflict.value)}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Constituents</h2>
      <div className="panel tablewrap">
        <table>
          <tbody>
            {entity.members.map((m) => (
              <tr key={m.pk}>
                <td style={{ width: "16rem", overflowWrap: "anywhere" }}>
                  <Link className="rowlink" href={`/object/${entity.type}/${encodeURIComponent(m.pk)}`}>
                    {m.pk}
                  </Link>
                </td>
                <td>{m.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
