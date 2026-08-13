// Minimal eval harness: each case sends a fresh prompt through the agent and
// grades the final text. Expectation shapes: {contains: [...]} (all substrings,
// case-insensitive) and/or {proposalFor: "<action>"} (the run staged a pending
// proposal for that action; eval proposals are auto-rejected afterwards).

import { getPool } from "@/db/client";
import { AGENT_MODEL, runAgent } from "./agent";

export interface Expectation {
  contains?: string[];
  proposalFor?: string;
}

export function grade(
  output: string,
  expect: Expectation,
  proposals: { action_api: string }[]
): { passed: boolean; detail: Record<string, unknown> } {
  const detail: Record<string, unknown> = {};
  let passed = true;
  if (expect.contains) {
    const missing = expect.contains.filter(
      (s) => !output.toLowerCase().includes(s.toLowerCase())
    );
    detail.missing = missing;
    if (missing.length) passed = false;
  }
  if (expect.proposalFor) {
    const found = proposals.some((p) => p.action_api === expect.proposalFor);
    detail.proposalFound = found;
    if (!found) passed = false;
  }
  return { passed, detail };
}

export async function runEvals(): Promise<{ runId: number; passed: number; failed: number }> {
  const pool = getPool();
  const cases = (await pool.query(`select * from eval_case order by name`)).rows;
  const run = await pool.query(`insert into eval_run (model) values ($1) returning id`, [
    AGENT_MODEL,
  ]);
  const runId = Number(run.rows[0].id);
  let passed = 0;
  let failed = 0;

  for (const c of cases) {
    const actor = `eval:${runId}:${c.name}`;
    const turn = await runAgent([], c.prompt, { actor });
    const output = turn.error
      ? `ERROR: ${turn.error}`
      : turn.display.filter((d) => d.kind === "text").map((d) => d.text).join("\n");
    const proposals = (
      await pool.query(`select action_api from proposal where proposed_by = $1`, [actor])
    ).rows;
    const result = turn.error
      ? { passed: false, detail: { error: turn.error } }
      : grade(output, c.expect as Expectation, proposals);

    // Eval proposals never reach the real queue: auto-reject them.
    await pool.query(
      `update proposal set status = 'rejected', decided_by = 'eval-harness', decided_at = now()
       where proposed_by = $1 and status = 'pending'`,
      [actor]
    );

    await pool.query(
      `insert into eval_result (run_id, case_id, passed, output, detail) values ($1, $2, $3, $4, $5)`,
      [runId, c.id, result.passed, output.slice(0, 4000), JSON.stringify(result.detail)]
    );
    if (result.passed) passed++;
    else failed++;
  }

  await pool.query(
    `update eval_run set finished_at = now(), passed = $2, failed = $3 where id = $1`,
    [runId, passed, failed]
  );
  return { runId, passed, failed };
}
