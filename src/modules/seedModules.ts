// Seeds a published demo module (an interactive watchlist dashboard wired
// through shared variables) and a demo dossier with live entity mentions.
// Idempotent: skips anything that already exists.

import { getPool } from "@/db/client";
import { createDossier, createModule, publishModule, saveDraft } from "./store";
import { ModuleDef } from "./types";

const WATCHLIST_OVERVIEW: ModuleDef = {
  variables: [
    { id: "wl", type: "string", initial: null },
    { id: "nat", type: "string", initial: null },
    { id: "selectedPerson", type: "objectRef", initial: null },
  ],
  widgets: [
    {
      id: "intro",
      widget: "markdown",
      width: "full",
      config: {
        content:
          "# Watchlist overview\nLive dashboard over ingested sanctions data. The two filters below drive the stat, the chart, and the table — pick a person in the table to open their card and source documents.",
      },
    },
    {
      id: "f_wl",
      widget: "facetFilter",
      title: "Watchlist",
      width: "third",
      config: { objectType: "person", property: "watchlist", variable: "wl", label: "Watchlist" },
    },
    {
      id: "f_nat",
      widget: "facetFilter",
      title: "Nationality",
      width: "third",
      config: { objectType: "person", property: "nationality", variable: "nat", label: "Nationality" },
    },
    {
      id: "count",
      widget: "stat",
      title: "Matching persons",
      width: "third",
      config: {
        objectType: "person",
        label: "persons in current selection",
        filters: [
          { property: "watchlist", op: "eq", var: "wl" },
          { property: "nationality", op: "eq", var: "nat" },
        ],
      },
    },
    {
      id: "chart",
      widget: "barChart",
      title: "By nationality",
      width: "half",
      config: {
        objectType: "person",
        groupBy: "nationality",
        limit: 10,
        filters: [{ property: "watchlist", op: "eq", var: "wl" }],
      },
    },
    {
      id: "tbl",
      widget: "objectTable",
      title: "Persons",
      width: "half",
      config: {
        objectType: "person",
        columns: ["nationality", "watchlist", "birth_date"],
        pageSize: 10,
        selectionVar: "selectedPerson",
        filters: [
          { property: "watchlist", op: "eq", var: "wl" },
          { property: "nationality", op: "eq", var: "nat" },
        ],
      },
    },
    {
      id: "card",
      widget: "objectCard",
      title: "Selected person",
      width: "half",
      config: { objectType: "person", pkVar: "selectedPerson" },
    },
    {
      id: "docs",
      widget: "linkedList",
      title: "Mentioned in documents",
      width: "half",
      config: { objectType: "person", pkVar: "selectedPerson", link: "mentionedInDocuments" },
    },
  ],
};

const KORD_DOSSIER = `# The Kord question

Two Russian LLCs surfaced by the Swiss SECO list have trigram-similar names and identical
jurisdictions: @[organization:NK-4RCSf2rUkSa2USSW7DM5Zb|KORD COMPANY] and
@[organization:NK-3xv3LAkNX8c9ThwzrvBwYU|Kord-Bunker].

The matcher scored the pair **0.65** — below the auto-merge threshold, so it sits in the
review queue rather than being resolved silently.

## Assessment

- Same jurisdiction (RU), same legal form, similar names.
- No shared hard identifier (no LEI on either record) — the strongest signal is absent.
- Bunker-fuel naming suggests a possibly related but distinct operating company.

## Recommendation

Keep unmerged pending corroboration. If a registry extract ties the two to one parent,
merge via the review queue — the merge is reversible either way.
`;

async function seedModules() {
  const pool = getPool();

  const existingModule = await pool.query(`select id from module where api_name = 'watchlist_overview'`);
  if (!existingModule.rows.length) {
    const m = await createModule(
      "watchlist_overview",
      "Watchlist overview",
      "Interactive dashboard over sanctions persons: filters, aggregate, table, detail card.",
      "seed"
    );
    await saveDraft(m.id, WATCHLIST_OVERVIEW, "seed");
    await publishModule(m.id, "seed");
    console.log("module watchlist_overview (published v1)");
  } else {
    console.log("module watchlist_overview exists");
  }

  const existingDossier = await pool.query(`select id from dossier where title = 'The Kord question'`);
  if (!existingDossier.rows.length) {
    const d = await createDossier("The Kord question", "seed");
    const { saveDossier } = await import("./store");
    await saveDossier(d.id, { body: KORD_DOSSIER }, "seed");
    console.log("dossier 'The Kord question'");
  } else {
    console.log("dossier exists");
  }

  await pool.end();
}

seedModules().catch((err) => {
  console.error(err);
  process.exit(1);
});
