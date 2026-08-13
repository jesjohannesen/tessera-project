// Standing automations: condition (object-set count vs threshold) → alert.
// The lean Automate: evaluated on demand or from the worker.

import { getPool } from "@/db/client";
import { aggregateObjectSet } from "@/ontology/objectSet";

const CMP: Record<string, (a: number, b: number) => boolean> = {
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  eq: (a, b) => a === b,
};

export interface AutomationRunResult {
  automation: string;
  value: number;
  triggered: boolean;
  error?: string;
}

export async function runAutomations(actor = "worker"): Promise<AutomationRunResult[]> {
  const pool = getPool();
  const rows = (await pool.query(`select * from automation where enabled`)).rows;
  const results: AutomationRunResult[] = [];

  for (const a of rows) {
    try {
      const agg = await aggregateObjectSet(
        { type: a.object_type, filter: a.filter ?? undefined },
        { metrics: [{ fn: "count", as: "n" }] }
      );
      const value = Number(agg.groups[0]?.n ?? 0);
      const triggered = CMP[a.comparator](value, a.threshold);
      await pool.query(
        `update automation set last_run_at = now(), last_value = $2${triggered ? ", last_triggered_at = now()" : ""} where id = $1`,
        [a.id, value]
      );
      if (triggered) {
        await pool.query(
          `insert into alert (automation_id, message, value) values ($1, $2, $3)`,
          [a.id, `${a.display_name}: count ${value} ${a.comparator} ${a.threshold}`, value]
        );
        await pool.query(
          `insert into audit_log (actor, category, detail) values ($1, 'automationTriggered', $2)`,
          [actor, JSON.stringify({ automation: a.api_name, value, threshold: a.threshold })]
        );
      }
      results.push({ automation: a.api_name, value, triggered });
    } catch (err) {
      results.push({ automation: a.api_name, value: -1, triggered: false, error: (err as Error).message });
    }
  }
  return results;
}
