import Link from "next/link";
import { listModules } from "@/modules/store";
import { CreateModuleForm } from "./CreateModuleForm";

export const dynamic = "force-dynamic";

export default async function ModulesPage() {
  const modules = await listModules();
  return (
    <main>
      <h1>Modules</h1>
      <p className="sub">
        User-built products over the ontology: widgets wired together by variables, published as
        immutable versions. This is the Workshop-in-miniature layer.
      </p>

      <CreateModuleForm />

      <div className="panel tablewrap" style={{ marginTop: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Module</th>
              <th>Widgets (draft)</th>
              <th>Published</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link className="rowlink" href={`/modules/${m.id}`}>
                    {m.displayName}
                  </Link>
                  <div className="section-note">{m.description}</div>
                </td>
                <td className="num">{m.draft.widgets.length}</td>
                <td>{m.publishedVersion ? `v${m.publishedVersion}` : <span className="chip">draft only</span>}</td>
                <td className="num">{new Date(m.updatedAt).toISOString().slice(0, 16).replace("T", " ")}</td>
                <td>
                  <Link className="runbtn" href={`/modules/${m.id}/edit`}>
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {!modules.length && (
              <tr>
                <td colSpan={5} className="empty">
                  No modules yet — create one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
