// Offline smoke test for Phase 2: matcher scoring, auto-resolution, the
// review queue, transitive merge, canonical flattened reads, unresolve, and
// per-value provenance from both write paths. Fixtures only, no network.

import { getPool } from "@/db/client";
import { writeToOntology } from "@/data/ontologyWriter";
import { applyAction } from "@/ontology/actions";
import { loadObjectSet } from "@/ontology/objectSet";
import { decideCandidate, runMatcher } from "@/resolve/matcher";
import {
  getResolvedEntity,
  resolutionForObject,
  unresolve,
} from "@/resolve/resolutions";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}`, detail ?? "");
  }
}

const FX = "fixture:res:";

async function cleanup(pool: ReturnType<typeof getPool>) {
  await pool.query(
    `delete from resolution where id in (
       select distinct m.resolution_id from resolution_member m
       join obj o on o.id = m.obj_id where o.pk_value like $1
     )`,
    [`${FX}%`]
  );
  await pool.query(`delete from obj where pk_value like $1`, [`${FX}%`]);
  await pool.query(`delete from resolution where status = 'active' and id not in (select resolution_id from resolution_member)`);
}

async function main() {
  const pool = getPool();
  await cleanup(pool);

  console.log("— fixtures —");
  await writeToOntology(
    [
      {
        kind: "object",
        type: "person",
        pk: `${FX}a`,
        props: { name: "Viktor Baranov", birth_date: "1969-04-02", nationality: "RU", watchlist: "fixture-list-a" },
      },
      {
        kind: "object",
        type: "person",
        pk: `${FX}b`,
        props: { name: "Viktor BARANOV", aliases: ["V. Baranov"], birth_date: "1969-04-02", nationality: "RU", watchlist: "fixture-list-b" },
      },
      {
        kind: "object",
        type: "person",
        pk: `${FX}c`,
        props: { name: "Viktor Baranof", nationality: "RU" },
      },
      {
        kind: "object",
        type: "person",
        pk: `${FX}d`,
        props: { name: "Helga Strand", nationality: "NO" },
      },
    ],
    "smoke-resolve",
    "fixture"
  );

  console.log("— matcher: auto vs review —");
  const run1 = await runMatcher("person", "smoke-resolve");
  const personRun = run1.find((r) => r.type === "person");
  check("matcher scored pairs", (personRun?.pairsScored ?? 0) >= 2, personRun);
  check("auto-resolved the exact match", (personRun?.autoResolved ?? 0) >= 1, personRun);

  const resA = await resolutionForObject("person", `${FX}a`);
  const resB = await resolutionForObject("person", `${FX}b`);
  check(
    "a and b share one resolution",
    resA !== null && resB !== null && resA.canonicalKey === resB.canonicalKey,
    { resA, resB }
  );
  const resD = await resolutionForObject("person", `${FX}d`);
  check("unrelated person untouched", resD === null);

  const pending = await pool.query(
    `select c.id from resolution_candidate c
     join obj a on a.id = c.obj_a join obj b on b.id = c.obj_b
     where c.status = 'pending' and (a.pk_value like $1 or b.pk_value like $1)`,
    [`${FX}%`]
  );
  // The fuzzy variant pairs with BOTH members of the auto-resolved bag.
  check("fuzzy variant queued for review (both pairs)", pending.rows.length === 2, pending.rows.length);

  console.log("— review accept → transitive merge —");
  const { canonicalKey } = await decideCandidate(Number(pending.rows[0].id), "accepted", "smoke-resolve");
  check("accept folded into the existing bag", canonicalKey === resA!.canonicalKey, {
    canonicalKey,
    expected: resA!.canonicalKey,
  });

  const pendingAfter = await pool.query(
    `select count(*)::int as n from resolution_candidate c
     join obj a on a.id = c.obj_a join obj b on b.id = c.obj_b
     where c.status = 'pending' and (a.pk_value like $1 or b.pk_value like $1)`,
    [`${FX}%`]
  );
  check("sibling candidate auto-closed by the merge", pendingAfter.rows[0].n === 0, pendingAfter.rows[0].n);

  const entity = await getResolvedEntity(resA!.canonicalKey);
  check("three constituents", entity.members.length === 3, entity.members.map((m) => m.pk));
  const birth = entity.merged.find((m) => m.property === "birth_date");
  check("merged view fills from members", birth?.value === "1969-04-02" && birth.fromPk === `${FX}a`);
  const watch = entity.merged.find((m) => m.property === "watchlist");
  check(
    "conflicting values preserved with attribution",
    watch?.value === "fixture-list-a" && watch.conflicts?.length === 1,
    watch
  );

  console.log("— matcher idempotency —");
  const run2 = await runMatcher("person", "smoke-resolve");
  const personRun2 = run2.find((r) => r.type === "person");
  check(
    "second run finds nothing new",
    (personRun2?.autoResolved ?? 0) === 0 && (personRun2?.queued ?? 0) === 0,
    personRun2
  );

  console.log("— unresolve —");
  await unresolve(resA!.canonicalKey, "smoke-resolve");
  const resAAfter = await resolutionForObject("person", `${FX}a`);
  check("members stand alone after unresolve", resAAfter === null);
  const persons = await loadObjectSet({
    type: "person",
    filter: { op: "startsWith", property: "person_id", value: FX },
  });
  check("constituents still individually queryable", persons.totalCount === 4, persons.totalCount);

  console.log("— provenance card stack —");
  const sourceCards = await pool.query(
    `select p.property, p.writer, p.origin from prop_provenance p
     join obj o on o.id = p.obj_id where o.pk_value = $1 order by p.id`,
    [`${FX}a`]
  );
  check(
    "ingest wrote source-origin cards",
    sourceCards.rows.length >= 4 && sourceCards.rows.every((r) => r.origin === "source" && r.writer === "smoke-resolve"),
    sourceCards.rows.length
  );

  await writeToOntology(
    [{ kind: "object", type: "person", pk: `${FX}a`, props: { watchlist: "fixture-list-a2" } }],
    "smoke-resolve",
    "fixture-2"
  );
  const watchCards = await pool.query(
    `select p.value from prop_provenance p join obj o on o.id = p.obj_id
     where o.pk_value = $1 and p.property = 'watchlist' order by p.id`,
    [`${FX}a`]
  );
  check("changed value appends a card", watchCards.rows.length === 2, watchCards.rows);

  await writeToOntology(
    [{ kind: "object", type: "person", pk: `${FX}a`, props: { watchlist: "fixture-list-a2" } }],
    "smoke-resolve",
    "fixture-3"
  );
  const watchCards2 = await pool.query(
    `select count(*)::int as n from prop_provenance p join obj o on o.id = p.obj_id
     where o.pk_value = $1 and p.property = 'watchlist'`,
    [`${FX}a`]
  );
  check("unchanged value appends nothing", watchCards2.rows[0].n === 2, watchCards2.rows[0].n);

  const edit = await applyAction(
    "updatePersonNotes",
    { person: `${FX}a`, notes: "Fixture note." },
    { actor: "smoke-resolve" }
  );
  check("action applied", edit.valid === true);
  const editCards = await pool.query(
    `select p.writer, p.origin, p.source_ref from prop_provenance p
     join obj o on o.id = p.obj_id where o.pk_value = $1 and p.property = 'notes'`,
    [`${FX}a`]
  );
  check(
    "action wrote edit-origin card with action ref",
    editCards.rows.length === 1 &&
      editCards.rows[0].origin === "edit" &&
      editCards.rows[0].writer === "action:updatePersonNotes" &&
      !!editCards.rows[0].source_ref,
    editCards.rows
  );

  await cleanup(pool);
  console.log(failures === 0 ? "\nALL RESOLVE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
