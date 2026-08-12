import Link from "next/link";
import { searchObjects } from "@/search/search";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const groups = q ? await searchObjects(q) : [];
  const total = groups.reduce((n, g) => n + g.total, 0);

  return (
    <main>
      <h1>Search</h1>
      {q ? (
        <p className="sub">
          {total} match{total === 1 ? "" : "es"} for <strong>{q}</strong> across{" "}
          {groups.length} object type{groups.length === 1 ? "" : "s"}.
        </p>
      ) : (
        <p className="sub">Type a query in the search box above.</p>
      )}

      {groups.map((g) => (
        <section key={g.type}>
          <h2>
            {g.typeLabel} · {g.total}
          </h2>
          <div className="panel tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Matched on</th>
                  <th>Snippet</th>
                </tr>
              </thead>
              <tbody>
                {g.hits.map((h) => (
                  <tr key={h.pk}>
                    <td>
                      <Link className="rowlink" href={`/object/${h.type}/${encodeURIComponent(h.pk)}`}>
                        {h.title ?? h.pk}
                      </Link>
                    </td>
                    <td>
                      <span className="chip">{h.matchedOn}</span>
                    </td>
                    <td style={{ maxWidth: "28rem", color: "var(--muted)" }}>{h.snippet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {g.total > g.hits.length && (
            <p className="section-note">Showing {g.hits.length} of {g.total}.</p>
          )}
        </section>
      ))}

      {q && !groups.length && <p className="empty">No matches.</p>}
    </main>
  );
}
