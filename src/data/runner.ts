// The runner: executes syncs (source → raw dataset) and builds (transforms in
// topological order, incremental via per-input transaction watermarks read
// from each transform's last successful job — build history IS the state).

import { getPool } from "@/db/client";
import { CONNECTORS } from "./connectors";
import {
  DsRecord,
  abortTxn,
  appendRecords,
  beginTxn,
  commitTxn,
  latestCommittedTxn,
  readRecords,
} from "./datasets";
import { OntologyOut, writeToOntology } from "./ontologyWriter";
import { TRANSFORM_REGISTRY } from "./transforms";

export interface SyncRunResult {
  source: string;
  status: "succeeded" | "failed";
  inserted?: number;
  skipped?: number;
  note?: string;
  error?: string;
}

export async function runSyncs(sourceApi?: string): Promise<SyncRunResult[]> {
  const pool = getPool();
  const rows = (
    await pool.query(
      `select s.id as sync_id, s.dataset_id, s.cursor, src.api_name, src.type, src.config
       from sync s join source src on src.id = s.source_id
       where src.enabled ${sourceApi ? "and src.api_name = $1" : ""}
       order by src.api_name`,
      sourceApi ? [sourceApi] : []
    )
  ).rows;
  if (sourceApi && !rows.length) throw new Error(`No enabled source named ${sourceApi}`);

  const results: SyncRunResult[] = [];
  for (const row of rows) {
    const connector = CONNECTORS[row.type];
    let txnId: number | null = null;
    try {
      const fetched = await connector(row.config);
      txnId = await beginTxn(row.dataset_id, "append", { source: row.api_name });
      const { inserted, skipped } = await appendRecords(row.dataset_id, txnId, fetched.records);
      if (inserted === 0) {
        await abortTxn(txnId, "no new records");
      } else {
        await commitTxn(txnId, { inserted, skipped, note: fetched.note ?? null });
      }
      await pool.query(
        `update sync set last_run_at = now(), last_status = 'succeeded', last_error = null where id = $1`,
        [row.sync_id]
      );
      await pool.query(
        `insert into audit_log (actor, category, detail) values ('worker', 'dataLoad', $1)`,
        [JSON.stringify({ sync: row.api_name, inserted, skipped, note: fetched.note ?? null })]
      );
      results.push({ source: row.api_name, status: "succeeded", inserted, skipped, note: fetched.note });
    } catch (err) {
      const message = (err as Error).message;
      if (txnId !== null) await abortTxn(txnId, message);
      await pool.query(
        `update sync set last_run_at = now(), last_status = 'failed', last_error = $2 where id = $1`,
        [row.sync_id, message]
      );
      results.push({ source: row.api_name, status: "failed", error: message });
    }
  }
  return results;
}

export interface JobRunResult {
  transform: string;
  status: "succeeded" | "failed" | "skipped";
  rowsOut?: number;
  objects?: number;
  links?: number;
  error?: string;
}

interface TransformRow {
  id: string;
  api_name: string;
  inputs: string[];
  output_kind: "dataset" | "ontology";
  output_dataset: string | null;
  entrypoint: string;
}

/** Topological order over declared inputs/outputs (dataset api names). */
function topoSort(transforms: TransformRow[]): TransformRow[] {
  const byOutput = new Map<string, TransformRow>();
  for (const t of transforms) if (t.output_dataset) byOutput.set(t.output_dataset, t);
  const visited = new Set<string>();
  const ordered: TransformRow[] = [];
  const visit = (t: TransformRow, path: Set<string>) => {
    if (visited.has(t.api_name)) return;
    if (path.has(t.api_name)) throw new Error(`Transform cycle at ${t.api_name}`);
    path.add(t.api_name);
    for (const input of t.inputs) {
      const upstream = byOutput.get(input);
      if (upstream) visit(upstream, path);
    }
    path.delete(t.api_name);
    visited.add(t.api_name);
    ordered.push(t);
  };
  for (const t of transforms) visit(t, new Set());
  return ordered;
}

export async function runBuild(trigger: string): Promise<{ buildId: number; jobs: JobRunResult[] }> {
  const pool = getPool();
  const transforms = topoSort(
    (await pool.query(`select * from transform order by api_name`)).rows as TransformRow[]
  );
  const build = await pool.query(
    `insert into build (trigger) values ($1) returning id`,
    [trigger]
  );
  const buildId = Number(build.rows[0].id);
  const jobs: JobRunResult[] = [];
  let failed = false;

  for (const t of transforms) {
    const fn = TRANSFORM_REGISTRY[t.entrypoint];
    if (!fn) {
      jobs.push({ transform: t.api_name, status: "failed", error: `Unknown entrypoint ${t.entrypoint}` });
      failed = true;
      continue;
    }

    // Watermarks: what the last successful job of this transform had consumed.
    const lastJob = await pool.query(
      `select read_from from job where transform_id = $1 and status = 'succeeded' order by id desc limit 1`,
      [t.id]
    );
    const prevWatermarks: Record<string, number> = lastJob.rows[0]?.read_from ?? {};

    const inputs: Record<string, DsRecord[]> = {};
    const newWatermarks: Record<string, number> = {};
    let totalNew = 0;
    try {
      for (const inputApi of t.inputs) {
        const after = prevWatermarks[inputApi] ?? 0;
        const records = await readRecords(inputApi, { afterTxn: after });
        inputs[inputApi] = records;
        newWatermarks[inputApi] = Math.max(await latestCommittedTxn(inputApi), after);
        totalNew += records.length;
      }
    } catch (err) {
      jobs.push({ transform: t.api_name, status: "failed", error: (err as Error).message });
      failed = true;
      continue;
    }

    if (totalNew === 0) {
      await pool.query(
        `insert into job (build_id, transform_id, status, read_from, finished_at) values ($1, $2, 'skipped', $3, now())`,
        [buildId, t.id, JSON.stringify(prevWatermarks)]
      );
      jobs.push({ transform: t.api_name, status: "skipped" });
      continue;
    }

    const job = await pool.query(
      `insert into job (build_id, transform_id, read_from) values ($1, $2, $3) returning id`,
      [buildId, t.id, JSON.stringify(newWatermarks)]
    );
    const jobId = Number(job.rows[0].id);
    try {
      const out = fn(inputs);
      let rowsOut = out.length;
      let wroteTxn: number | null = null;
      let objects = 0;
      let links = 0;

      if (t.output_kind === "dataset") {
        if (!t.output_dataset) throw new Error("dataset-bound transform lacks output_dataset");
        const datasetId = (
          await pool.query(`select id from dataset where api_name = $1`, [t.output_dataset])
        ).rows[0]?.id;
        if (!datasetId) throw new Error(`Unknown output dataset ${t.output_dataset}`);
        wroteTxn = await beginTxn(datasetId, "append", { transform: t.api_name, buildId });
        const { inserted } = await appendRecords(datasetId, wroteTxn, out as DsRecord[]);
        rowsOut = inserted;
        if (inserted === 0) await abortTxn(wroteTxn, "no new rows");
        else await commitTxn(wroteTxn, { inserted });
      } else {
        const stats = await writeToOntology(
          out as OntologyOut[],
          `transform:${t.api_name}`,
          `build:${buildId}`
        );
        objects = stats.objects;
        links = stats.links;
      }

      await pool.query(
        `update job set status = 'succeeded', wrote_txn_id = $2, rows_out = $3, objects_upserted = $4, links_upserted = $5, finished_at = now() where id = $1`,
        [jobId, wroteTxn, rowsOut, objects, links]
      );
      jobs.push({ transform: t.api_name, status: "succeeded", rowsOut, objects, links });
    } catch (err) {
      const message = (err as Error).message;
      await pool.query(
        `update job set status = 'failed', error = $2, finished_at = now() where id = $1`,
        [jobId, message]
      );
      jobs.push({ transform: t.api_name, status: "failed", error: message });
      failed = true;
    }
  }

  await pool.query(
    `update build set status = $2, finished_at = now(), error = $3 where id = $1`,
    [
      buildId,
      failed ? "failed" : "succeeded",
      failed ? jobs.filter((j) => j.error).map((j) => `${j.transform}: ${j.error}`).join("; ") : null,
    ]
  );
  return { buildId, jobs };
}
