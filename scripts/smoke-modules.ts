// Offline smoke test for Phase 4: filter resolution (the variable wiring),
// module CRUD + draft/publish/version history, definition validation, and
// dossier mentions. No network beyond Postgres.

import { getPool } from "@/db/client";
import { resolveFilters } from "@/modules/filters";
import {
  createDossier,
  createModule,
  extractMentions,
  getDossier,
  getModule,
  publishModule,
  saveDossier,
  saveDraft,
} from "@/modules/store";
import { ModuleDef } from "@/modules/types";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}`, detail ?? "");
  }
}

const FX_API = "fixture_smoke_module";

async function cleanup(pool: ReturnType<typeof getPool>) {
  await pool.query(`delete from module where api_name = $1`, [FX_API]);
  await pool.query(`delete from dossier where title like 'fixture:%'`);
}

async function main() {
  const pool = getPool();
  await cleanup(pool);

  console.log("— filter resolution (variable wiring) —");
  const filters = [
    { property: "watchlist", op: "eq" as const, var: "wl" },
    { property: "nationality", op: "eq" as const, var: "nat" },
    { property: "dwt", op: "gt" as const, value: "5000" },
  ];
  const none = resolveFilters(filters, { wl: null, nat: null });
  check("numeric coercion + static value", JSON.stringify(none) === JSON.stringify({ op: "gt", property: "dwt", value: 5000 }), none);
  const one = resolveFilters(filters, { wl: "eu_fsf", nat: null });
  check(
    "empty variables skip their filters",
    JSON.stringify(one) ===
      JSON.stringify({ op: "and", clauses: [{ op: "eq", property: "watchlist", value: "eu_fsf" }, { op: "gt", property: "dwt", value: 5000 }] }),
    one
  );
  check("no filters -> undefined", resolveFilters([], {}) === undefined);

  console.log("— module lifecycle —");
  const auditBefore = (
    await pool.query(
      `select count(*)::int as n from audit_log where category = 'modulePublished' and detail->>'apiName' = $1`,
      [FX_API]
    )
  ).rows[0].n;
  const mod = await createModule(FX_API, "Fixture module", null, "smoke");
  check("created with empty draft", mod.draft.widgets.length === 0 && mod.publishedVersion === 0);

  const dupe = await createModule(FX_API, "Fixture again", null, "smoke").catch((e) => e);
  check("duplicate api_name rejected", dupe instanceof Error && String(dupe.message).includes("already exists"));

  const badDef = { variables: [], widgets: [{ id: "w1", widget: "stat", width: "huge", config: {} }] };
  const badSave = await saveDraft(mod.id, badDef as unknown as ModuleDef, "smoke").catch((e) => e);
  check("invalid width rejected", badSave instanceof Error && String(badSave.message).includes("invalid width"));

  const def: ModuleDef = {
    variables: [{ id: "sel", type: "objectRef", initial: null }],
    widgets: [
      { id: "w1", widget: "stat", width: "third", config: { objectType: "person", label: "persons" } },
      { id: "w2", widget: "objectTable", width: "full", config: { objectType: "person", selectionVar: "sel" } },
    ],
  };
  await saveDraft(mod.id, def, "smoke");
  const afterSave = await getModule(mod.id);
  check("draft persisted", afterSave.draft.widgets.length === 2 && afterSave.published === null);

  const p1 = await publishModule(mod.id, "smoke");
  check("first publish is v1", p1.version === 1);
  await saveDraft(mod.id, { ...def, widgets: def.widgets.slice(0, 1) }, "smoke");
  const p2 = await publishModule(mod.id, "smoke");
  check("second publish is v2", p2.version === 2);

  const afterPublish = await getModule(mod.id);
  check(
    "published definition tracks latest publish",
    afterPublish.published?.widgets.length === 1 && afterPublish.publishedVersion === 2
  );

  const versions = await pool.query(
    `select version, definition from module_version where module_id = $1 order by version`,
    [mod.id]
  );
  check(
    "version history immutable rows",
    versions.rows.length === 2 &&
      versions.rows[0].definition.widgets.length === 2 &&
      versions.rows[1].definition.widgets.length === 1,
    versions.rows.length
  );

  const auditRes = await pool.query(
    `select count(*)::int as n from audit_log where category = 'modulePublished' and detail->>'apiName' = $1`,
    [FX_API]
  );
  check("publishes audited", auditRes.rows[0].n - auditBefore === 2, auditRes.rows[0].n);

  console.log("— dossiers —");
  const dossier = await createDossier("fixture: kord notes", "smoke");
  await saveDossier(
    dossier.id,
    { body: "See @[organization:NK-abc|Kord Co] and @[person:P-001|Maren Voss], plus **bold**." },
    "smoke"
  );
  const loaded = await getDossier(dossier.id);
  const mentions = extractMentions(loaded.body);
  check(
    "mentions extracted with type/pk/label",
    mentions.length === 2 &&
      mentions[0].type === "organization" &&
      mentions[0].pk === "NK-abc" &&
      mentions[1].label === "Maren Voss",
    mentions
  );

  await cleanup(pool);
  console.log(failures === 0 ? "\nALL MODULE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
