import Link from "next/link";
import { getPool } from "@/db/client";
import { datasetIdByApi } from "@/data/datasets";

export const dynamic = "force-dynamic";

export default async function DatasetPage({
  params,
}: {
  params: Promise<{ api: string }>;
}) {
  const { api } = await params;
  const pool = getPool();
  const datasetId = await datasetIdByApi(api);
  const [info, txns, sample] = await Promise.all([
    pool.query(`select * from dataset where id = $1`, [datasetId]),
    pool.query(
      `select t.id, t.type, t.status, t.started_at, t.committed_at, t.meta,
              count(r.id) as records
       from ds_txn t left join ds_record r on r.txn_id = t.id
       where t.dataset_id = $1
       group by t.id order by t.id desc limit 25`,
      [datasetId]
    ),
    pool.query(
      `select r.pk, r.payload, r.txn_id from ds_record r
       join ds_txn t on t.id = r.txn_id
       where r.dataset_id = $1 and t.status = 'committed'
       order by r.id desc limit 15`,
      [datasetId]
    ),
  ]);
  const d = info.rows[0];

  return (
    <main>
      <p className="mono">
        <Link href="/data">Data layer</Link>
      </p>
      <h1>{d.display_name}</h1>
      <p className="sub">{d.description}</p>

      <h2>Transactions</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Txn</th>
              <th>Type</th>
              <th>Status</th>
              <th>Records</th>
              <th>Committed</th>
              <th>Meta</th>
            </tr>
          </thead>
          <tbody>
            {txns.rows.map((t) => (
              <tr key={t.id}>
                <td className="num">{t.id}</td>
                <td>{t.type}</td>
                <td>
                  <span
                    className={`chip ${t.status === "committed" ? "source" : t.status === "aborted" ? "" : "edit"}`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="num">{t.records}</td>
                <td className="num">
                  {t.committed_at
                    ? new Date(t.committed_at).toISOString().replace("T", " ").slice(5, 19)
                    : "—"}
                </td>
                <td>
                  <code className="inline">{JSON.stringify(t.meta)}</code>
                </td>
              </tr>
            ))}
            {!txns.rows.length && (
              <tr>
                <td colSpan={6} className="empty">
                  No transactions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Latest records</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>PK</th>
              <th>Txn</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {sample.rows.map((r, i) => (
              <tr key={i}>
                <td style={{ maxWidth: "16rem", overflowWrap: "anywhere" }}>{r.pk}</td>
                <td className="num">{r.txn_id}</td>
                <td>
                  <code className="inline" style={{ overflowWrap: "anywhere" }}>
                    {JSON.stringify(r.payload).slice(0, 260)}
                  </code>
                </td>
              </tr>
            ))}
            {!sample.rows.length && (
              <tr>
                <td colSpan={3} className="empty">
                  No records yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
