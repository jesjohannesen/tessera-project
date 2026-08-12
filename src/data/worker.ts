// Worker CLI:
//   tsx src/data/worker.ts sync [sourceApi]   run syncs (all sources by default)
//   tsx src/data/worker.ts build              run a build over all transforms
//   tsx src/data/worker.ts all                sync everything, then build
//   tsx src/data/worker.ts loop [minutes]     run `all` on an interval

import { getPool } from "@/db/client";
import { runBuild, runSyncs } from "./runner";

async function syncAndReport(sourceApi?: string) {
  const results = await runSyncs(sourceApi);
  for (const r of results) {
    if (r.status === "succeeded") {
      console.log(
        `sync ${r.source}: +${r.inserted} new, ${r.skipped} duplicate${r.note ? ` (${r.note})` : ""}`
      );
    } else {
      console.error(`sync ${r.source} FAILED: ${r.error}`);
    }
  }
  return results;
}

async function buildAndReport(trigger: string) {
  const { buildId, jobs } = await runBuild(trigger);
  for (const j of jobs) {
    if (j.status === "succeeded") {
      console.log(
        `job ${j.transform}: ${j.objects ? `${j.objects} objects` : `${j.rowsOut} rows`}${j.links ? `, ${j.links} links` : ""}`
      );
    } else if (j.status === "skipped") {
      console.log(`job ${j.transform}: skipped (no new input)`);
    } else {
      console.error(`job ${j.transform} FAILED: ${j.error}`);
    }
  }
  console.log(`build ${buildId} done`);
}

async function main() {
  const [cmd = "all", arg] = process.argv.slice(2);
  if (cmd === "sync") {
    await syncAndReport(arg);
  } else if (cmd === "build") {
    await buildAndReport("cli");
  } else if (cmd === "all") {
    await syncAndReport();
    await buildAndReport("cli");
  } else if (cmd === "loop") {
    const minutes = Number(arg ?? 30);
    console.log(`worker loop: every ${minutes}m (ctrl-c to stop)`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await syncAndReport();
        await buildAndReport("loop");
      } catch (err) {
        console.error("worker iteration failed:", err);
      }
      await new Promise((r) => setTimeout(r, minutes * 60_000));
    }
  } else {
    console.error(`Unknown command: ${cmd}. Use sync|build|all|loop.`);
    process.exit(1);
  }
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
