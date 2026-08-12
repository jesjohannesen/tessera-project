// Offline smoke test for the data layer: transaction visibility, dedupe,
// snapshot semantics, incremental watermarks through the build runner, and
// the overlay contract (re-ingestion never clobbers analyst edits).
// Uses a fixture dataset + transform; no network required.

import { getPool } from "@/db/client";
import {
  abortTxn,
  appendRecords,
  beginTxn,
  commitTxn,
  ensureDataset,
  readRecords,
} from "@/data/datasets";
import { runBuild } from "@/data/runner";
import { writeToOntology } from "@/data/ontologyWriter";
import { getObject } from "@/ontology/objectSet";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}`, detail ?? "");
  }
}

const FIXTURE_DS = "fixture_rss";
const FIXTURE_TRANSFORM = "fixture_to_documents";

function fx(pk: string, title: string) {
  return {
    pk: `fixture:${pk}`,
    payload: {
      guid: `fixture:${pk}`,
      title,
      link: `fixture:${pk}`,
      published_at: "2026-08-12T00:00:00Z",
      snippet: `Fixture snippet for ${title}`,
      feed_name: "Fixture Feed",
      feed_url: "fixture://feed",
    },
  };
}

async function cleanup(pool: ReturnType<typeof getPool>) {
  await pool.query(`delete from transform where api_name = $1`, [FIXTURE_TRANSFORM]);
  await pool.query(`delete from dataset where api_name = $1`, [FIXTURE_DS]);
  await pool.query(
    `delete from obj where pk_value like 'fixture:%' and object_type_id = (select id from object_type where api_name = 'document')`
  );
}

async function main() {
  const pool = getPool();
  await cleanup(pool);

  console.log("— transactions & visibility —");
  const dsId = await ensureDataset(FIXTURE_DS, "Fixture RSS", "Smoke-test fixture.");
  const t1 = await beginTxn(dsId, "append");
  await appendRecords(dsId, t1, [fx("a", "Alpha"), fx("b", "Beta")]);
  let visible = await readRecords(FIXTURE_DS);
  check("open txn invisible", visible.length === 0, visible.length);
  await commitTxn(t1);
  visible = await readRecords(FIXTURE_DS);
  check("committed txn visible", visible.length === 2);

  const t2 = await beginTxn(dsId, "append");
  const dd = await appendRecords(dsId, t2, [fx("b", "Beta again"), fx("c", "Gamma")]);
  await commitTxn(t2);
  check("dedupe by pk", dd.inserted === 1 && dd.skipped === 1, dd);

  const t3 = await beginTxn(dsId, "append");
  await appendRecords(dsId, t3, [fx("d", "Delta")]);
  await abortTxn(t3, "smoke abort");
  visible = await readRecords(FIXTURE_DS);
  check("aborted txn invisible", visible.length === 3, visible.length);

  const incr = await readRecords(FIXTURE_DS, { afterTxn: t1 });
  check("incremental read after watermark", incr.length === 1 && incr[0].pk === "fixture:c");

  console.log("— build runner: incremental watermarks —");
  await pool.query(
    `insert into transform (api_name, display_name, description, inputs, output_kind, entrypoint)
     values ($1, 'Fixture → documents', 'Smoke fixture.', $2, 'ontology', 'rssToDocuments')`,
    [FIXTURE_TRANSFORM, [FIXTURE_DS]]
  );
  const b1 = await runBuild("smoke-data");
  const j1 = b1.jobs.find((j) => j.transform === FIXTURE_TRANSFORM);
  check("fixture job processed 3 records", j1?.status === "succeeded" && j1.objects === 3, j1);

  const docA = await getObject("document", "fixture:a");
  check("fixture document in ontology", docA.props.title === "Alpha" && docA.props.source_name === "Fixture Feed");

  const b2 = await runBuild("smoke-data");
  const j2 = b2.jobs.find((j) => j.transform === FIXTURE_TRANSFORM);
  check("second build skips (watermark)", j2?.status === "skipped", j2);

  const t4 = await beginTxn(dsId, "append");
  await appendRecords(dsId, t4, [fx("e", "Epsilon")]);
  await commitTxn(t4);
  const b3 = await runBuild("smoke-data");
  const j3 = b3.jobs.find((j) => j.transform === FIXTURE_TRANSFORM);
  check("third build processes only the new record", j3?.status === "succeeded" && j3.objects === 1, j3);

  console.log("— overlay contract on re-ingestion —");
  await pool.query(
    `update obj set edit_props = edit_props || '{"title": "Analyst-corrected title"}'::jsonb
     where pk_value = 'fixture:a' and object_type_id = (select id from object_type where api_name = 'document')`
  );
  await writeToOntology(
    [
      {
        kind: "object",
        type: "document",
        pk: "fixture:a",
        props: { title: "Alpha v2 from source", text: "Updated snippet" },
      },
    ],
    "smoke-data"
  );
  const docA2 = await getObject("document", "fixture:a");
  check(
    "analyst edit survives re-ingestion",
    docA2.props.title === "Analyst-corrected title" &&
      docA2.sourceProps.title === "Alpha v2 from source" &&
      docA2.props.text === "Updated snippet",
    { props: docA2.props.title, source: docA2.sourceProps.title }
  );

  console.log("— snapshot semantics —");
  const t5 = await beginTxn(dsId, "snapshot");
  await appendRecords(dsId, t5, [fx("z", "Zeta")], { dedupe: false });
  await commitTxn(t5);
  visible = await readRecords(FIXTURE_DS);
  check("snapshot supersedes prior records", visible.length === 1 && visible[0].pk === "fixture:z", visible.length);

  await cleanup(pool);
  console.log(failures === 0 ? "\nALL DATA CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
