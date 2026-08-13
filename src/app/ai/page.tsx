import { getPool } from "@/db/client";
import { AGENT_MODEL } from "@/ai/agent";
import { ChatPanel } from "./ChatPanel";
import { PostButton } from "@/app/components/PostButton";

export const dynamic = "force-dynamic";

export default async function AiPage() {
  const pool = getPool();
  const [proposals, automations, alerts, evalCases, lastRun] = await Promise.all([
    pool.query(`select * from proposal order by created_at desc limit 12`),
    pool.query(`select * from automation order by display_name`),
    pool.query(`select al.*, a.display_name from alert al join automation a on a.id = al.automation_id order by al.created_at desc limit 6`),
    pool.query(`
      select c.name, c.prompt, r.passed, r.detail from eval_case c
      left join lateral (
        select er.passed, er.detail from eval_result er
        join eval_run run on run.id = er.run_id
        where er.case_id = c.id order by er.id desc limit 1
      ) r on true
      order by c.name`),
    pool.query(`select * from eval_run order by id desc limit 1`),
  ]);
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <main>
      <h1>AI layer</h1>
      <p className="sub">
        A governed analyst over the ontology: reads via object-set tools, writes only as staged
        proposals you approve. Model: <code className="inline">{AGENT_MODEL}</code>.
      </p>
      {!hasKey && (
        <p className="banner">
          <code className="inline">ANTHROPIC_API_KEY</code> is not set — add it to{" "}
          <code className="inline">.env</code> and restart the dev server to enable chat and evals.
          Proposals and automations work without it.
        </p>
      )}

      <ChatPanel />

      <h2>Proposal queue · {proposals.rows.filter((p) => p.status === "pending").length} pending</h2>
      <p className="section-note">
        The propose-then-promote gate: nothing the model stages is applied until you approve it here.
      </p>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Parameters</th>
              <th>Rationale</th>
              <th>By</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {proposals.rows.map((p) => (
              <tr key={p.id}>
                <td><code className="inline">{p.action_api}</code></td>
                <td style={{ maxWidth: "16rem", overflowWrap: "anywhere" }}>
                  <code className="inline">{JSON.stringify(p.params)}</code>
                </td>
                <td style={{ maxWidth: "16rem" }}>{p.rationale}</td>
                <td>{p.proposed_by}</td>
                <td>
                  <span className={`chip ${p.status === "pending" ? "edit" : p.status === "approved" ? "source" : ""}`}>
                    {p.status}
                  </span>
                  {p.error && <div className="section-note">{p.error}</div>}
                </td>
                <td>
                  {p.status === "pending" && (
                    <span style={{ display: "flex", gap: "0.4rem" }}>
                      <PostButton url={`/api/ai/proposals/${p.id}`} body={{ decision: "approved" }} label="Approve" />
                      <PostButton url={`/api/ai/proposals/${p.id}`} body={{ decision: "rejected" }} label="Reject" />
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!proposals.rows.length && (
              <tr><td colSpan={6} className="empty">No proposals yet — ask the analyst to make a change.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Automations</h2>
      <div style={{ marginBottom: "0.6rem" }}>
        <PostButton url="/api/ai/automations/run" label="Evaluate now" />
      </div>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr><th>Automation</th><th>Condition</th><th>Last value</th><th>Last run</th><th>Last triggered</th></tr>
          </thead>
          <tbody>
            {automations.rows.map((a) => (
              <tr key={a.id}>
                <td>{a.display_name}</td>
                <td>
                  <code className="inline">
                    count({a.object_type}{a.filter ? ` where ${JSON.stringify(a.filter)}` : ""}) {a.comparator} {a.threshold}
                  </code>
                </td>
                <td className="num">{a.last_value ?? "—"}</td>
                <td className="num">{a.last_run_at ? new Date(a.last_run_at).toISOString().slice(5, 16).replace("T", " ") : "never"}</td>
                <td className="num">{a.last_triggered_at ? new Date(a.last_triggered_at).toISOString().slice(5, 16).replace("T", " ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {alerts.rows.length > 0 && (
        <>
          <h3>Recent alerts</h3>
          <div className="panel tablewrap">
            <table>
              <tbody>
                {alerts.rows.map((al) => (
                  <tr key={al.id}>
                    <td className="num">{new Date(al.created_at).toISOString().slice(5, 16).replace("T", " ")}</td>
                    <td>{al.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Evals</h2>
      <p className="section-note">
        {lastRun.rows.length
          ? `Last run: ${lastRun.rows[0].passed} passed, ${lastRun.rows[0].failed} failed (${lastRun.rows[0].model}).`
          : "Never run."}{" "}
        Each case runs a fresh agent conversation and grades the answer; eval proposals are auto-rejected.
      </p>
      <div style={{ marginBottom: "0.6rem" }}>
        <PostButton url="/api/ai/evals/run" label="Run evals" busyLabel="Running (may take a minute)…" />
      </div>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr><th>Case</th><th>Prompt</th><th>Last result</th></tr>
          </thead>
          <tbody>
            {evalCases.rows.map((c) => (
              <tr key={c.name}>
                <td><code className="inline">{c.name}</code></td>
                <td style={{ maxWidth: "24rem" }}>{c.prompt}</td>
                <td>
                  {c.passed === null || c.passed === undefined ? (
                    <span className="chip">not run</span>
                  ) : c.passed ? (
                    <span className="chip source">pass</span>
                  ) : (
                    <span className="chip edit">fail</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
