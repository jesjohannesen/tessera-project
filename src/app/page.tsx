import Link from "next/link";
import { getPool } from "@/db/client";
import { getOntology } from "@/ontology/metadata";

export const dynamic = "force-dynamic";

export default async function Home() {
  const meta = await getOntology();
  const pool = getPool();
  const [countRows, auditRows] = await Promise.all([
    pool.query(
      `select object_type_id, count(*)::int as n from obj where not deleted group by 1`
    ),
    pool.query(`select ts, actor, category, detail from audit_log order by ts desc limit 8`),
  ]);
  const counts = new Map<string, number>(
    countRows.rows.map((r) => [r.object_type_id, r.n])
  );

  return (
    <main>
      <h1>Ontology overview</h1>
      <p className="sub">
        The metadata plane: object types, link types, and actions — schema as data, instances underneath.
      </p>

      <h2>Object types</h2>
      <div className="grid">
        {meta.types.map((t) => (
          <Link className="card" key={t.apiName} href={`/browse/${t.apiName}`}>
            <span className="mono kind">{t.kind}</span>
            <div className="count">{counts.get(t.id) ?? 0}</div>
            <div className="name">{t.displayName}</div>
            <span className="mono dim">{t.properties.length} properties</span>
          </Link>
        ))}
      </div>

      <h2>Link types</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Link</th>
              <th>From → To</th>
              <th>Traversal names</th>
              <th>Cardinality</th>
            </tr>
          </thead>
          <tbody>
            {meta.links.map((l) => (
              <tr key={l.id}>
                <td>{l.displayName}</td>
                <td>
                  {l.objectTypeA} → {l.objectTypeB}
                </td>
                <td>
                  <code className="inline">{l.apiNameAToB}</code>{" "}
                  <code className="inline">{l.apiNameBToA}</code>
                </td>
                <td>{l.cardinality.replace(/_/g, "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Actions</h2>
      <p className="section-note">The only write path. Every mutation is validated, logged, and audited.</p>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Parameters</th>
              <th>Rules</th>
            </tr>
          </thead>
          <tbody>
            {meta.actions.map((a) => (
              <tr key={a.apiName}>
                <td>
                  <code className="inline">{a.apiName}</code>
                  <div className="section-note">{a.description}</div>
                </td>
                <td>
                  {a.parameters.map((p) => (
                    <span className="chip" key={p.apiName}>
                      {p.apiName}: {p.type === "object_ref" ? p.objectType : p.type}
                      {p.required ? " *" : ""}
                    </span>
                  ))}
                </td>
                <td>
                  {a.rules.map((r, i) => (
                    <span className="chip" key={i}>
                      {r.type}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recent activity</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Category</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {auditRows.rows.map((r, i) => (
              <tr key={i}>
                <td className="num">{new Date(r.ts).toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{r.actor}</td>
                <td>
                  <span className="chip">{r.category}</span>
                </td>
                <td>
                  <code className="inline">{JSON.stringify(r.detail)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
