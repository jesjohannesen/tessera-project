import Link from "next/link";
import { getPool } from "@/db/client";
import { RunButton } from "./RunButton";

export const dynamic = "force-dynamic";

export default async function DataPage() {
  const pool = getPool();
  const [sources, datasets, transforms, builds] = await Promise.all([
    pool.query(`
      select src.api_name, src.display_name, src.type, src.enabled,
             s.schedule_minutes, s.last_run_at, s.last_status, s.last_error,
             d.api_name as dataset_api
      from source src
      join sync s on s.source_id = src.id
      join dataset d on d.id = s.dataset_id
      order by src.api_name`),
    pool.query(`
      select d.api_name, d.display_name, d.description,
             count(distinct t.id) filter (where t.status = 'committed') as txns,
             max(t.id) filter (where t.status = 'committed') as latest_txn,
             count(r.id) filter (where t.status = 'committed') as records
      from dataset d
      left join ds_txn t on t.dataset_id = d.id
      left join ds_record r on r.txn_id = t.id
      group by d.id order by d.api_name`),
    pool.query(`
      select t.api_name, t.display_name, t.inputs, t.output_kind, t.output_dataset, t.entrypoint,
             j.status as last_status, j.rows_out, j.objects_upserted, j.links_upserted,
             j.finished_at as last_run, j.error as last_error
      from transform t
      left join lateral (
        select * from job where transform_id = t.id order by id desc limit 1
      ) j on true
      order by t.api_name`),
    pool.query(`
      select b.id, b.trigger, b.status, b.started_at, b.finished_at, b.error,
             count(j.id) as jobs,
             count(j.id) filter (where j.status = 'succeeded') as ok,
             count(j.id) filter (where j.status = 'skipped') as skipped
      from build b left join job j on j.build_id = b.id
      group by b.id order by b.id desc limit 8`),
  ]);

  return (
    <main>
      <h1>Data layer</h1>
      <p className="sub">
        Sources sync into transaction-logged datasets; declared transforms map raw records into the
        ontology. Lineage is computed from declarations.
      </p>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.4rem" }}>
        <RunButton kind="sync" label="Run all syncs" />
        <RunButton kind="build" label="Run build" />
      </div>

      <h2>Sources &amp; syncs</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>Target dataset</th>
              <th>Every</th>
              <th>Last run</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.rows.map((s) => (
              <tr key={s.api_name}>
                <td>
                  {s.display_name}
                  {s.last_error && <div className="section-note">{s.last_error}</div>}
                </td>
                <td>
                  <span className="chip">{s.type}</span>
                </td>
                <td>
                  <Link className="rowlink" href={`/data/${s.dataset_api}`}>
                    {s.dataset_api}
                  </Link>
                </td>
                <td className="num">{s.schedule_minutes}m</td>
                <td className="num">
                  {s.last_run_at
                    ? new Date(s.last_run_at).toISOString().replace("T", " ").slice(5, 19)
                    : "never"}
                </td>
                <td>
                  {s.last_status ? (
                    <span className={`chip ${s.last_status === "succeeded" ? "source" : "edit"}`}>
                      {s.last_status}
                    </span>
                  ) : (
                    <span className="chip">pending</span>
                  )}
                </td>
                <td>
                  <RunButton kind="sync" target={s.api_name} label="Sync" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Datasets</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Dataset</th>
              <th>Records</th>
              <th>Committed txns</th>
              <th>Latest txn</th>
            </tr>
          </thead>
          <tbody>
            {datasets.rows.map((d) => (
              <tr key={d.api_name}>
                <td>
                  <Link className="rowlink" href={`/data/${d.api_name}`}>
                    {d.api_name}
                  </Link>
                  <div className="section-note">{d.description}</div>
                </td>
                <td className="num">{d.records}</td>
                <td className="num">{d.txns}</td>
                <td className="num">{d.latest_txn ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Transforms &amp; lineage</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Lineage</th>
              <th>Entrypoint</th>
              <th>Last job</th>
            </tr>
          </thead>
          <tbody>
            {transforms.rows.map((t) => (
              <tr key={t.api_name}>
                <td>
                  <span className="mono dim">{(t.inputs as string[]).join(" + ")}</span>
                  <span className="mono"> → {t.api_name} → </span>
                  <span className="mono dim">
                    {t.output_kind === "ontology" ? "ontology" : t.output_dataset}
                  </span>
                  {t.last_error && <div className="section-note">{t.last_error}</div>}
                </td>
                <td>
                  <code className="inline">{t.entrypoint}</code>
                </td>
                <td>
                  {t.last_status ? (
                    <>
                      <span className={`chip ${t.last_status === "failed" ? "edit" : "source"}`}>
                        {t.last_status}
                      </span>{" "}
                      <span className="section-note" style={{ display: "inline" }}>
                        {t.output_kind === "ontology"
                          ? `${t.objects_upserted ?? 0} objects, ${t.links_upserted ?? 0} links`
                          : `${t.rows_out ?? 0} rows`}
                      </span>
                    </>
                  ) : (
                    <span className="chip">never run</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Builds</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Jobs</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {builds.rows.map((b) => (
              <tr key={b.id}>
                <td className="num">{b.id}</td>
                <td>{b.trigger}</td>
                <td>
                  <span className={`chip ${b.status === "failed" ? "edit" : "source"}`}>
                    {b.status}
                  </span>
                </td>
                <td className="num">
                  {b.ok}/{b.jobs} ok{Number(b.skipped) ? `, ${b.skipped} skipped` : ""}
                </td>
                <td className="num">
                  {new Date(b.started_at).toISOString().replace("T", " ").slice(5, 19)}
                </td>
              </tr>
            ))}
            {!builds.rows.length && (
              <tr>
                <td colSpan={5} className="empty">
                  No builds yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
