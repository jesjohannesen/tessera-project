// Offline smoke test for Phase 5: tool schema generation, governed tool
// execution, the propose-then-promote gate end to end (stage → approve →
// applied via the actions engine; stage → reject), automations, and the eval
// grader. No Claude API calls — the agent loop itself needs a key and is
// exercised via the UI/evals when one is present.

import { getPool } from "@/db/client";
import { getOntology } from "@/ontology/metadata";
import { buildTools, decideProposal, executeTool, ontologyDigest } from "@/ai/tools";
import { runAutomations } from "@/ai/automations";
import { grade } from "@/ai/evals";
import { getObject } from "@/ontology/objectSet";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}`, detail ?? "");
  }
}

async function main() {
  const pool = getPool();
  await pool.query(`delete from proposal where proposed_by like 'smoke-ai%'`);
  // Reset the fixture edit from prior runs so the pending-gate check is valid.
  await pool.query(
    `update obj set edit_props = edit_props - 'notes'
     where pk_value = 'P-003' and object_type_id = (select id from object_type where api_name = 'person')`
  );

  console.log("— tool schema generation —");
  const meta = await getOntology();
  const tools = buildTools(meta);
  check("six tools generated", tools.length === 6, tools.map((t) => t.name));
  const digest = ontologyDigest(meta);
  check(
    "digest lists types, links, actions",
    digest.includes("person") && digest.includes("employedBy") && digest.includes("updatePersonNotes")
  );
  check(
    "query tool carries the digest",
    tools.find((t) => t.name === "query_objects")!.description.includes("vessel")
  );

  console.log("— governed reads —");
  const q = JSON.parse(
    await executeTool(
      "query_objects",
      { type: "vessel", filter: { op: "eq", property: "flag", value: "PA" } },
      "smoke-ai"
    )
  );
  check("query_objects works", q.totalCount === 1 && q.objects[0].title === "Kara Dawn", q);
  const agg = JSON.parse(
    await executeTool("aggregate_objects", { type: "vessel", groupBy: "flag" }, "smoke-ai")
  );
  check("aggregate_objects works", agg.groups.length === 2, agg);
  const bad = JSON.parse(
    await executeTool("query_objects", { type: "person", filter: { op: "eq", property: "notes", value: "x" } }, "smoke-ai")
  );
  check("unsearchable property rejected as tool error", typeof bad.error === "string", bad);

  console.log("— propose-then-promote —");
  const invalid = JSON.parse(
    await executeTool(
      "propose_action",
      { action: "createPerson", parameters: { person_id: "bogus", name: "" }, rationale: "test" },
      "smoke-ai"
    )
  );
  check("invalid proposal not staged", invalid.staged === false && invalid.errors.length >= 2, invalid);

  const staged = JSON.parse(
    await executeTool(
      "propose_action",
      {
        action: "updatePersonNotes",
        parameters: { person: "P-003", notes: "Smoke-test proposal note." },
        rationale: "Testing the review gate.",
      },
      "smoke-ai"
    )
  );
  check("valid proposal staged, not applied", staged.staged === true && !!staged.proposalId, staged);
  const before = await getObject("person", "P-003");
  check("target object untouched while pending", before.props.notes !== "Smoke-test proposal note.");

  const approved = await decideProposal(staged.proposalId, "approved", "smoke-ai");
  check("approval applies via actions engine", approved.status === "approved", approved);
  const after = await getObject("person", "P-003");
  check("edit landed after approval", after.props.notes === "Smoke-test proposal note.");
  check("edit is overlay-origin", after.editProps.notes === "Smoke-test proposal note.");

  const staged2 = JSON.parse(
    await executeTool(
      "propose_action",
      { action: "updatePersonNotes", parameters: { person: "P-003", notes: "Second note." }, rationale: "r" },
      "smoke-ai"
    )
  );
  const rejected = await decideProposal(staged2.proposalId, "rejected", "smoke-ai");
  check("rejection recorded", rejected.status === "rejected");
  const afterReject = await getObject("person", "P-003");
  check("rejected proposal never applied", afterReject.props.notes === "Smoke-test proposal note.");
  const double = await decideProposal(staged2.proposalId, "approved", "smoke-ai");
  check("decided proposals cannot be re-decided", double.status === "not_pending");

  console.log("— automations —");
  const autoResults = await runAutomations("smoke-ai");
  check("automations evaluated", autoResults.length >= 2, autoResults);
  const ru = autoResults.find((r) => r.automation === "ru_person_watch");
  check("RU threshold automation triggered on live data", ru !== undefined && ru.triggered === true, ru);
  const alerts = await pool.query(`select count(*)::int as n from alert`);
  check("alert rows written", alerts.rows[0].n >= 1, alerts.rows[0].n);

  console.log("— eval grader —");
  const g1 = grade("The owner is Meridian Freight Holdings (O-001).", { contains: ["Meridian Freight"] }, []);
  check("contains pass", g1.passed === true);
  const g2 = grade("No idea.", { contains: ["Meridian"] }, []);
  check("contains fail", g2.passed === false);
  const g3 = grade("Staged for review.", { proposalFor: "updatePersonNotes", contains: ["review"] }, [
    { action_api: "updatePersonNotes" },
  ]);
  check("proposalFor pass", g3.passed === true);
  const g4 = grade("Done, applied!", { proposalFor: "updatePersonNotes" }, []);
  check("proposalFor fail without staged proposal", g4.passed === false);

  await pool.query(`delete from proposal where proposed_by like 'smoke-ai%'`);
  console.log(failures === 0 ? "\nALL AI CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
