// End-to-end smoke test for the Phase 0 spine. Runs against the live database:
// metadata, object-set loads, pivots, aggregation, action apply, overlay
// semantics, criteria rejection, and soft delete.

import { getPool } from "@/db/client";
import { getOntology } from "@/ontology/metadata";
import { aggregateObjectSet, getObject, listLinked, loadObjectSet } from "@/ontology/objectSet";
import { applyAction } from "@/ontology/actions";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}`, detail ?? "");
  }
}

async function main() {
  console.log("— metadata —");
  const meta = await getOntology();
  check("7 object types", meta.types.length === 7, meta.types.map((t) => t.apiName));
  check("10 link types", meta.links.length === 10);
  check("5 action types", meta.actions.length === 5);

  console.log("— object-set loads —");
  const persons = await loadObjectSet({ type: "person" });
  check("3 persons", persons.totalCount === 3, persons);

  const paVessels = await loadObjectSet({
    type: "vessel",
    filter: { op: "eq", property: "flag", value: "PA" },
  });
  check("1 PA-flagged vessel", paVessels.totalCount === 1 && paVessels.objects[0].pk === "9312001");

  const bigVessels = await loadObjectSet({
    type: "vessel",
    filter: { op: "gt", property: "dwt", value: 50000 },
  });
  check("1 vessel over 50k dwt", bigVessels.totalCount === 1 && bigVessels.objects[0].title === "Selene Star");

  const aliasHit = await loadObjectSet({
    type: "person",
    filter: { op: "contains", property: "aliases", value: "M. Voss" },
  });
  check("alias array contains", aliasHit.totalCount === 1 && aliasHit.objects[0].pk === "P-001");

  console.log("— pivots (search-around) —");
  const merVessels = await loadObjectSet({
    type: "organization",
    filter: { op: "eq", property: "org_id", value: "O-001" },
    pivots: [{ link: "vesselsOwned" }],
  });
  check("Meridian owns 1 vessel", merVessels.totalCount === 1 && merVessels.objects[0].title === "Kara Dawn");

  const twoHop = await loadObjectSet({
    type: "person",
    filter: { op: "eq", property: "name", value: "Maren Voss" },
    pivots: [{ link: "employedBy" }, { link: "vesselsOwned" }],
  });
  check("Maren → employer → vessel", twoHop.totalCount === 1 && twoHop.objects[0].pk === "9312001");

  const reverse = await listLinked("vessel", "9312001", "vesselOwner");
  check("vessel → owner (reverse)", reverse.objects.length === 1 && reverse.objects[0].title === "Meridian Freight Holdings");

  console.log("— aggregation —");
  const byFlag = await aggregateObjectSet(
    { type: "vessel" },
    { groupBy: { property: "flag" }, metrics: [{ fn: "count" }, { fn: "sum", property: "dwt" }] }
  );
  check("group vessels by flag", byFlag.groups.length === 2, byFlag.groups);

  console.log("— actions: overlay semantics —");
  const noteRes = await applyAction("updatePersonNotes", {
    person: "P-001",
    notes: "Director listed in registry extract D-001.",
  }, { actor: "smoke-test" });
  check("updatePersonNotes applied", noteRes.valid === true && (noteRes.edits?.length ?? 0) === 1);

  const maren = await getObject("person", "P-001");
  check("edit landed in overlay", maren.editProps.notes !== undefined && maren.props.notes === "Director listed in registry extract D-001.");
  check("source props untouched", maren.sourceProps.notes === undefined && maren.sourceProps.name === "Maren Voss");
  check("version bumped", maren.version === 2, maren.version);

  console.log("— actions: create + link + criteria —");
  const created = await applyAction("createPerson", {
    person_id: "P-100",
    name: "Test Analystson",
    nationality: "DK",
  }, { actor: "smoke-test" });
  check("createPerson applied", created.valid === true);

  const badCreate = await applyAction("createPerson", { person_id: "bogus", name: "" }, { actor: "smoke-test", validateOnly: true });
  check("criteria reject empty name + bad id", badCreate.valid === false && (badCreate.errors?.length ?? 0) >= 2, badCreate.errors);

  const dupe = await applyAction("createPerson", { person_id: "P-100", name: "Test Analystson" }, { actor: "smoke-test" }).catch((e) => e);
  check("duplicate pk rejected", dupe instanceof Error && String(dupe.message).includes("already exists"));

  const employed = await applyAction("recordEmployment", { person: "P-100", organization: "O-003" }, { actor: "smoke-test" });
  check("recordEmployment applied", employed.valid === true);

  const northstarStaff = await listLinked("organization", "O-003", "employees");
  check("new employment traversable", northstarStaff.objects.some((o) => o.pk === "P-100"), northstarStaff.objects.map((o) => o.pk));

  console.log("— actions: soft delete —");
  const removed = await applyAction("removePerson", { person: "P-100" }, { actor: "smoke-test" });
  check("removePerson applied", removed.valid === true);
  const personsAfter = await loadObjectSet({ type: "person" });
  check("deleted person excluded from queries", personsAfter.totalCount === 3);

  console.log("— history —");
  const pool = getPool();
  const editCount = await pool.query(`select count(*)::int as n from edit_log`);
  check("edit_log populated", editCount.rows[0].n >= 4, editCount.rows[0].n);
  const auditCount = await pool.query(`select count(*)::int as n from audit_log where category = 'actionApplied'`);
  check("audit_log has actionApplied rows", auditCount.rows[0].n >= 4, auditCount.rows[0].n);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
