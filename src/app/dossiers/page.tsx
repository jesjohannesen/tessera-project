import Link from "next/link";
import { listDossiers, extractMentions } from "@/modules/store";
import { CreateDossierForm } from "./CreateDossierForm";

export const dynamic = "force-dynamic";

export default async function DossiersPage() {
  const dossiers = await listDossiers();
  return (
    <main>
      <h1>Dossiers</h1>
      <p className="sub">
        Analyst-authored documents with live entity mentions — the written product of an
        investigation, still connected to the ontology.
      </p>

      <CreateDossierForm />

      <div className="panel tablewrap" style={{ marginTop: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Dossier</th>
              <th>Referenced entities</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {dossiers.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link className="rowlink" href={`/dossiers/${d.id}`}>
                    {d.title}
                  </Link>
                </td>
                <td className="num">{extractMentions(d.body).length}</td>
                <td className="num">{new Date(d.updatedAt).toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
            {!dossiers.length && (
              <tr>
                <td colSpan={3} className="empty">
                  No dossiers yet — create one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
