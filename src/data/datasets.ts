// Dataset core: every write is a typed transaction (append or snapshot);
// reads see only committed transactions. A snapshot supersedes everything
// before it, which gives cheap time-travel and incremental reads.

import { getPool } from "@/db/client";
import { ApiError } from "@/ontology/types";

export interface DsRecord {
  pk: string;
  payload: Record<string, unknown>;
  txnId?: number;
}

export async function ensureDataset(
  apiName: string,
  displayName: string,
  description?: string
): Promise<string> {
  const pool = getPool();
  await pool.query(
    `insert into dataset (api_name, display_name, description) values ($1, $2, $3)
     on conflict (api_name) do nothing`,
    [apiName, displayName, description ?? null]
  );
  const res = await pool.query(`select id from dataset where api_name = $1`, [apiName]);
  return res.rows[0].id;
}

export async function datasetIdByApi(apiName: string): Promise<string> {
  const res = await getPool().query(`select id from dataset where api_name = $1`, [apiName]);
  if (!res.rows.length) throw new ApiError(404, `Unknown dataset: ${apiName}`);
  return res.rows[0].id;
}

export async function beginTxn(
  datasetId: string,
  type: "append" | "snapshot",
  meta: Record<string, unknown> = {}
): Promise<number> {
  const res = await getPool().query(
    `insert into ds_txn (dataset_id, type, meta) values ($1, $2, $3) returning id`,
    [datasetId, type, JSON.stringify(meta)]
  );
  return Number(res.rows[0].id);
}

export async function commitTxn(txnId: number, meta?: Record<string, unknown>) {
  await getPool().query(
    `update ds_txn set status = 'committed', committed_at = now()${meta ? `, meta = meta || $2::jsonb` : ""} where id = $1`,
    meta ? [txnId, JSON.stringify(meta)] : [txnId]
  );
}

export async function abortTxn(txnId: number, reason?: string) {
  await getPool().query(
    `update ds_txn set status = 'aborted', committed_at = now(), meta = meta || $2::jsonb where id = $1`,
    [txnId, JSON.stringify({ abortReason: reason ?? "unknown" })]
  );
}

/**
 * Append records inside an open transaction. With dedupe (default), records
 * whose pk already exists in the dataset's committed view are skipped, which
 * makes every sync idempotent regardless of cursors.
 */
export async function appendRecords(
  datasetId: string,
  txnId: number,
  records: DsRecord[],
  opts: { dedupe?: boolean } = {}
): Promise<{ inserted: number; skipped: number }> {
  const pool = getPool();
  const dedupe = opts.dedupe ?? true;
  let candidates = records;

  if (dedupe && records.length) {
    const pks = records.map((r) => r.pk);
    const existing = new Set<string>(
      (
        await pool.query(
          `select distinct r.pk from ds_record r
           join ds_txn t on t.id = r.txn_id
           where r.dataset_id = $1 and (t.status = 'committed' or t.id = $2) and r.pk = any($3)`,
          [datasetId, txnId, pks]
        )
      ).rows.map((r) => r.pk)
    );
    candidates = records.filter((r) => !existing.has(r.pk));
    // Also drop duplicate pks within the batch itself.
    const seen = new Set<string>();
    candidates = candidates.filter((r) => (seen.has(r.pk) ? false : (seen.add(r.pk), true)));
  }

  const CHUNK = 500;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r) => {
      params.push(datasetId, txnId, r.pk, JSON.stringify(r.payload));
      const n = params.length;
      values.push(`($${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
    });
    await pool.query(
      `insert into ds_record (dataset_id, txn_id, pk, payload) values ${values.join(", ")}`,
      params
    );
  }
  return { inserted: candidates.length, skipped: records.length - candidates.length };
}

export async function latestCommittedTxn(datasetApi: string): Promise<number> {
  const res = await getPool().query(
    `select coalesce(max(t.id), 0) as latest from ds_txn t
     join dataset d on d.id = t.dataset_id
     where d.api_name = $1 and t.status = 'committed'`,
    [datasetApi]
  );
  return Number(res.rows[0].latest);
}

/**
 * Read the committed view of a dataset. afterTxn enables incremental reads
 * (only records committed after that transaction). A snapshot transaction
 * resets the view: records before the latest committed snapshot are dead.
 */
export async function readRecords(
  datasetApi: string,
  opts: { afterTxn?: number; limit?: number } = {}
): Promise<DsRecord[]> {
  const pool = getPool();
  const datasetId = await datasetIdByApi(datasetApi);
  const snap = await pool.query(
    `select coalesce(max(id), 0) as s from ds_txn
     where dataset_id = $1 and type = 'snapshot' and status = 'committed'`,
    [datasetId]
  );
  const snapFloor = Number(snap.rows[0].s);
  // A snapshot after the caller's watermark resets the view: read from the
  // snapshot inclusively. Otherwise read strictly after the watermark.
  const after = opts.afterTxn;
  const [cmp, bound] =
    after !== undefined && snapFloor <= after ? [">", after] : [">=", snapFloor];
  const res = await pool.query(
    `select r.pk, r.payload, r.txn_id from ds_record r
     join ds_txn t on t.id = r.txn_id
     where r.dataset_id = $1 and t.status = 'committed'
       and r.txn_id ${cmp} $2
     order by r.txn_id, r.id
     ${opts.limit ? `limit ${Math.floor(opts.limit)}` : ""}`,
    [datasetId, bound]
  );
  return res.rows.map((r) => ({ pk: r.pk, payload: r.payload, txnId: Number(r.txn_id) }));
}
