import Link from "next/link";
import { getPool } from "@/db/client";
import { getOntology } from "@/ontology/metadata";
import { listResolutions } from "@/resolve/resolutions";
import { PostButton } from "@/app/components/PostButton";

export const dynamic = "force-dynamic";

export default async function ResolvePage() {
  const pool = getPool();
  const meta = await getOntology();
  const [candidates, resolutions] = await Promise.all([
    pool.query(`
      select c.id, c.score, c.features, c.object_type_id,
             a.pk_value as pk_a, a.props as props_a,
             b.pk_value as pk_b, b.props as props_b
      from resolution_candidate c
      join obj a on a.id = c.obj_a
      join obj b on b.id = c.obj_b
      where c.status = 'pending'
      order by c.score desc
      limit 25`),
    listResolutions("active"),
  ]);

  const typeName = (id: string) => meta.types.find((t) => t.id === id)?.apiName ?? "?";

  return (
    <main>
      <h1>Entity resolution</h1>
      <p className="sub">
        The matcher blocks on fuzzy names, scores pairs on shared identifiers, auto-resolves
        confident matches, and queues the rest here for review. Merges are non-destructive and
        reversible.
      </p>

      <div style={{ marginBottom: "1.4rem" }}>
        <PostButton url="/api/resolve/matcher" label="Run matcher" busyLabel="Matching…" />
      </div>

      <h2>Review queue · {candidates.rows.length} pending</h2>
      {candidates.rows.map((c) => {
        const type = meta.types.find((t) => t.id === c.object_type_id);
        const props = [
          ...new Set([...Object.keys(c.props_a ?? {}), ...Object.keys(c.props_b ?? {})]),
        ].filter((p) => type?.properties.some((tp) => tp.apiName === p));
        return (
          <div className="panel" key={c.id} style={{ marginBottom: "0.9rem", padding: "0.9rem 1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <span className="mono">{typeName(c.object_type_id)}</span>
              <span className="chip source">score {Number(c.score).toFixed(2)}</span>
              {Object.entries(c.features as Record<string, unknown>).map(([k, v]) => (
                <span className="chip" key={k}>
                  {k}: {String(v)}
                </span>
              ))}
              <span style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
                <PostButton
                  url={`/api/resolve/candidates/${c.id}`}
                  body={{ decision: "accepted" }}
                  label="Merge"
                />
                <PostButton
                  url={`/api/resolve/candidates/${c.id}`}
                  body={{ decision: "rejected" }}
                  label="Reject"
                />
              </span>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>
                      <Link className="rowlink" href={`/object/${typeName(c.object_type_id)}/${encodeURIComponent(c.pk_a)}`}>
                        {c.pk_a}
                      </Link>
                    </th>
                    <th>
                      <Link className="rowlink" href={`/object/${typeName(c.object_type_id)}/${encodeURIComponent(c.pk_b)}`}>
                        {c.pk_b}
                      </Link>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {props.map((p) => {
                    const va = c.props_a?.[p];
                    const vb = c.props_b?.[p];
                    const same =
                      va != null && vb != null && JSON.stringify(va) === JSON.stringify(vb);
                    return (
                      <tr key={p}>
                        <td>{p}</td>
                        <td style={same ? { color: "var(--accent)" } : undefined}>
                          {va == null ? "" : Array.isArray(va) ? va.join(", ") : String(va)}
                        </td>
                        <td style={same ? { color: "var(--accent)" } : undefined}>
                          {vb == null ? "" : Array.isArray(vb) ? vb.join(", ") : String(vb)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {!candidates.rows.length && <p className="empty">Queue is empty — run the matcher.</p>}

      <h2>Active resolutions · {resolutions.length}</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Canonical</th>
              <th>Title</th>
              <th>Type</th>
              <th>Members</th>
              <th>Method</th>
              <th>Confidence</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {resolutions.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className="rowlink" href={`/entity/${r.canonicalKey}`}>
                    {r.canonicalKey}
                  </Link>
                </td>
                <td>{r.title}</td>
                <td>{r.type}</td>
                <td className="num">{r.memberCount}</td>
                <td>
                  <span className="chip">{r.method}</span>
                </td>
                <td className="num">{r.confidence != null ? Number(r.confidence).toFixed(2) : "—"}</td>
                <td>
                  <PostButton
                    url={`/api/resolve/resolutions/${r.canonicalKey}/unresolve`}
                    label="Unmerge"
                  />
                </td>
              </tr>
            ))}
            {!resolutions.length && (
              <tr>
                <td colSpan={7} className="empty">
                  No active resolutions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
