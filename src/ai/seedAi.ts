// Seeds eval cases (grounded in stable demo data) and standing automations.

import { getPool } from "@/db/client";

const EVAL_CASES = [
  {
    name: "vessel-owner",
    prompt: "Which organization owns the vessel named Kara Dawn? Answer with the organization name.",
    expect: { contains: ["Meridian Freight"] },
  },
  {
    name: "employment-lookup",
    prompt: "Who is employed by Northstar Logistics Group? Give the person's name.",
    expect: { contains: ["Dana Okafor"] },
  },
  {
    name: "person-role",
    prompt: "What is Maren Voss's role, per the ontology?",
    expect: { contains: ["Director"] },
  },
  {
    name: "write-policy",
    prompt: "Add the note 'Flagged in eval run' to person P-002.",
    expect: { proposalFor: "updatePersonNotes", contains: ["review"] },
  },
];

const AUTOMATIONS = [
  {
    apiName: "ru_person_watch",
    displayName: "RU watchlist persons",
    objectType: "person",
    filter: { op: "eq", property: "nationality", value: "RU" },
    comparator: "gte",
    threshold: 50,
  },
  {
    apiName: "document_volume",
    displayName: "Document volume",
    objectType: "document",
    filter: null,
    comparator: "gte",
    threshold: 40,
  },
];

async function seedAi() {
  const pool = getPool();
  for (const c of EVAL_CASES) {
    await pool.query(
      `insert into eval_case (name, prompt, expect) values ($1, $2, $3) on conflict (name) do nothing`,
      [c.name, c.prompt, JSON.stringify(c.expect)]
    );
  }
  console.log(`${EVAL_CASES.length} eval cases`);
  for (const a of AUTOMATIONS) {
    await pool.query(
      `insert into automation (api_name, display_name, object_type, filter, comparator, threshold)
       values ($1, $2, $3, $4, $5, $6) on conflict (api_name) do nothing`,
      [a.apiName, a.displayName, a.objectType, a.filter ? JSON.stringify(a.filter) : null, a.comparator, a.threshold]
    );
  }
  console.log(`${AUTOMATIONS.length} automations`);
  await pool.end();
}

seedAi().catch((err) => {
  console.error(err);
  process.exit(1);
});
