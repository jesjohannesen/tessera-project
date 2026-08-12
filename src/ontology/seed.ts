// Seeds the starter OSINT ontology (metadata plane) and a small fictional demo
// dataset (instance plane). Demo instances are written as source_props to
// simulate ingested data — actions then edit on top via the overlay.
// Idempotent: re-running skips anything that already exists.

import { getPool } from "@/db/client";

type P = [api: string, display: string, type: string, searchable?: boolean, required?: boolean];

const OBJECT_TYPES: {
  apiName: string;
  displayName: string;
  description: string;
  kind: "entity" | "event" | "document";
  pk: string;
  title: string;
  props: P[];
}[] = [
  {
    apiName: "person",
    displayName: "Person",
    description: "An individual appearing in open sources.",
    kind: "entity",
    pk: "person_id",
    title: "name",
    props: [
      ["person_id", "Person ID", "string", true, true],
      ["name", "Name", "string", true, true],
      ["aliases", "Aliases", "string_array", true],
      ["nationality", "Nationality", "string", true],
      ["birth_date", "Birth date", "date", true],
      ["role", "Role", "string", true],
      ["notes", "Notes", "string"],
    ],
  },
  {
    apiName: "organization",
    displayName: "Organization",
    description: "A company, agency, or other organization.",
    kind: "entity",
    pk: "org_id",
    title: "name",
    props: [
      ["org_id", "Org ID", "string", true, true],
      ["name", "Name", "string", true, true],
      ["jurisdiction", "Jurisdiction", "string", true],
      ["lei", "LEI", "string", true],
      ["org_type", "Type", "string", true],
      ["notes", "Notes", "string"],
    ],
  },
  {
    apiName: "vessel",
    displayName: "Vessel",
    description: "A ship, keyed by IMO number.",
    kind: "entity",
    pk: "imo",
    title: "name",
    props: [
      ["imo", "IMO", "string", true, true],
      ["mmsi", "MMSI", "string", true],
      ["name", "Name", "string", true, true],
      ["flag", "Flag", "string", true],
      ["vessel_type", "Type", "string", true],
      ["dwt", "Deadweight (t)", "integer", true],
    ],
  },
  {
    apiName: "aircraft",
    displayName: "Aircraft",
    description: "An aircraft, keyed by ICAO 24-bit address.",
    kind: "entity",
    pk: "icao24",
    title: "registration",
    props: [
      ["icao24", "ICAO24", "string", true, true],
      ["registration", "Registration", "string", true, true],
      ["model", "Model", "string", true],
      ["operator_name", "Operator", "string", true],
    ],
  },
  {
    apiName: "location",
    displayName: "Location",
    description: "A named place with coordinates.",
    kind: "entity",
    pk: "loc_id",
    title: "name",
    props: [
      ["loc_id", "Location ID", "string", true, true],
      ["name", "Name", "string", true, true],
      ["country", "Country", "string", true],
      ["lat", "Latitude", "double"],
      ["lon", "Longitude", "double"],
    ],
  },
  {
    apiName: "event",
    displayName: "Event",
    description: "Something that happened at a point in time.",
    kind: "event",
    pk: "event_id",
    title: "title",
    props: [
      ["event_id", "Event ID", "string", true, true],
      ["title", "Title", "string", true, true],
      ["event_type", "Type", "string", true],
      ["occurred_at", "Occurred at", "timestamp", true],
      ["summary", "Summary", "string"],
    ],
  },
  {
    apiName: "document",
    displayName: "Document",
    description: "A source document: article, filing, registry extract.",
    kind: "document",
    pk: "doc_id",
    title: "title",
    props: [
      ["doc_id", "Document ID", "string", true, true],
      ["title", "Title", "string", true, true],
      ["url", "URL", "string"],
      ["source_name", "Source", "string", true],
      ["published_at", "Published at", "timestamp", true],
      ["text", "Text", "string"],
    ],
  },
];

const LINK_TYPES: {
  aToB: string;
  bToA: string;
  display: string;
  a: string;
  b: string;
  cardinality?: "one_to_one" | "one_to_many" | "many_to_many";
}[] = [
  { aToB: "employedBy", bToA: "employees", display: "Employment", a: "person", b: "organization" },
  { aToB: "associates", bToA: "associatedBy", display: "Association", a: "person", b: "person" },
  { aToB: "vesselsOwned", bToA: "vesselOwner", display: "Vessel ownership", a: "organization", b: "vessel" },
  { aToB: "aircraftOperated", bToA: "aircraftOperator", display: "Aircraft operation", a: "organization", b: "aircraft" },
  { aToB: "involvedPersons", bToA: "eventsInvolvedIn", display: "Event involvement (person)", a: "event", b: "person" },
  { aToB: "involvedOrganizations", bToA: "eventsInvolvingOrg", display: "Event involvement (org)", a: "event", b: "organization" },
  { aToB: "involvedVessels", bToA: "vesselEvents", display: "Event involvement (vessel)", a: "event", b: "vessel" },
  { aToB: "eventLocation", bToA: "eventsAtLocation", display: "Event location", a: "event", b: "location" },
  { aToB: "mentionedPersons", bToA: "mentionedInDocuments", display: "Document mention (person)", a: "document", b: "person" },
  { aToB: "mentionedOrganizations", bToA: "orgMentionedInDocuments", display: "Document mention (org)", a: "document", b: "organization" },
];

const ACTIONS = [
  {
    apiName: "createPerson",
    displayName: "Create person",
    description: "Add a person to the ontology.",
    parameters: [
      { apiName: "person_id", type: "string", required: true },
      { apiName: "name", type: "string", required: true },
      { apiName: "nationality", type: "string" },
      { apiName: "role", type: "string" },
    ],
    submission_criteria: [
      { param: "name", op: "nonEmpty", message: "Name must not be empty" },
      { param: "person_id", op: "regex", value: "^P-\\d{3,}$", message: "person_id must match P-###" },
    ],
    rules: [
      {
        type: "create_object",
        objectType: "person",
        pkFrom: { kind: "parameter", param: "person_id" },
        properties: {
          name: { kind: "parameter", param: "name" },
          nationality: { kind: "parameter", param: "nationality" },
          role: { kind: "parameter", param: "role" },
        },
      },
    ],
  },
  {
    apiName: "createOrganization",
    displayName: "Create organization",
    description: "Add an organization to the ontology.",
    parameters: [
      { apiName: "org_id", type: "string", required: true },
      { apiName: "name", type: "string", required: true },
      { apiName: "jurisdiction", type: "string" },
    ],
    submission_criteria: [
      { param: "name", op: "nonEmpty", message: "Name must not be empty" },
    ],
    rules: [
      {
        type: "create_object",
        objectType: "organization",
        pkFrom: { kind: "parameter", param: "org_id" },
        properties: {
          name: { kind: "parameter", param: "name" },
          jurisdiction: { kind: "parameter", param: "jurisdiction" },
        },
      },
    ],
  },
  {
    apiName: "updatePersonNotes",
    displayName: "Update person notes",
    description: "Attach or revise analyst notes on a person (edit overlay).",
    parameters: [
      { apiName: "person", type: "object_ref", objectType: "person", required: true },
      { apiName: "notes", type: "string", required: true },
    ],
    submission_criteria: [
      { param: "notes", op: "maxLength", value: 4000, message: "Notes must be under 4000 characters" },
    ],
    rules: [
      {
        type: "modify_object",
        objectType: "person",
        targetParam: "person",
        properties: { notes: { kind: "parameter", param: "notes" } },
      },
    ],
  },
  {
    apiName: "recordEmployment",
    displayName: "Record employment",
    description: "Link a person to an organization as employment.",
    parameters: [
      { apiName: "person", type: "object_ref", objectType: "person", required: true },
      { apiName: "organization", type: "object_ref", objectType: "organization", required: true },
    ],
    submission_criteria: [],
    rules: [
      { type: "create_link", linkType: "employedBy", aParam: "person", bParam: "organization" },
    ],
  },
  {
    apiName: "removePerson",
    displayName: "Remove person",
    description: "Soft-delete a person from the ontology.",
    parameters: [
      { apiName: "person", type: "object_ref", objectType: "person", required: true },
    ],
    submission_criteria: [],
    rules: [{ type: "delete_object", objectType: "person", targetParam: "person" }],
  },
];

// ---- Fictional demo instances (written as source_props, simulating ingest) ----

const DEMO_OBJECTS: { type: string; pk: string; props: Record<string, unknown> }[] = [
  { type: "person", pk: "P-001", props: { person_id: "P-001", name: "Maren Voss", nationality: "DE", role: "Director", aliases: ["M. Voss"] } },
  { type: "person", pk: "P-002", props: { person_id: "P-002", name: "Ilya Radek", nationality: "CZ", role: "Broker", aliases: [] } },
  { type: "person", pk: "P-003", props: { person_id: "P-003", name: "Dana Okafor", nationality: "NG", role: "Operations manager", aliases: ["D. Okafor"] } },
  { type: "organization", pk: "O-001", props: { org_id: "O-001", name: "Meridian Freight Holdings", jurisdiction: "CY", org_type: "holding" } },
  { type: "organization", pk: "O-002", props: { org_id: "O-002", name: "Bluewater Chartering Ltd", jurisdiction: "MT", org_type: "chartering" } },
  { type: "organization", pk: "O-003", props: { org_id: "O-003", name: "Northstar Logistics Group", jurisdiction: "EE", org_type: "logistics" } },
  { type: "vessel", pk: "9312001", props: { imo: "9312001", mmsi: "355112000", name: "Kara Dawn", flag: "PA", vessel_type: "general cargo", dwt: 32400 } },
  { type: "vessel", pk: "9377402", props: { imo: "9377402", mmsi: "636220145", name: "Selene Star", flag: "LR", vessel_type: "tanker", dwt: 74100 } },
  { type: "aircraft", pk: "4b1a23", props: { icao24: "4b1a23", registration: "9H-TSA", model: "Gulfstream G550", operator_name: "Northstar Logistics Group" } },
  { type: "aircraft", pk: "a91f04", props: { icao24: "a91f04", registration: "N728QF", model: "Boeing 737-800", operator_name: "Charter (unattributed)" } },
  { type: "location", pk: "L-001", props: { loc_id: "L-001", name: "Limassol", country: "CY", lat: 34.7071, lon: 33.0226 } },
  { type: "location", pk: "L-002", props: { loc_id: "L-002", name: "Tallinn", country: "EE", lat: 59.437, lon: 24.7536 } },
  { type: "event", pk: "E-001", props: { event_id: "E-001", title: "Port call: Kara Dawn at Limassol", event_type: "port_call", occurred_at: "2026-07-18T09:40:00Z", summary: "Kara Dawn (IMO 9312001) called at Limassol; 36h alongside." } },
  { type: "event", pk: "E-002", props: { event_id: "E-002", title: "Registration change: Bluewater Chartering", event_type: "corporate_change", occurred_at: "2026-06-02T00:00:00Z", summary: "Bluewater Chartering re-registered with new directors." } },
  { type: "document", pk: "D-001", props: { doc_id: "D-001", title: "Registry extract: Meridian Freight Holdings", source_name: "corporate-registry", published_at: "2026-05-14T00:00:00Z", text: "Extract lists Maren Voss as director of Meridian Freight Holdings (CY)." } },
  { type: "document", pk: "D-002", props: { doc_id: "D-002", title: "Chartering network expands Baltic routes", source_name: "rss", published_at: "2026-07-30T06:00:00Z", text: "Trade press item naming Ilya Radek and Bluewater Chartering alongside Northstar Logistics Group." } },
];

const DEMO_LINKS: { link: string; a: [string, string]; b: [string, string] }[] = [
  { link: "employedBy", a: ["person", "P-001"], b: ["organization", "O-001"] },
  { link: "employedBy", a: ["person", "P-002"], b: ["organization", "O-002"] },
  { link: "employedBy", a: ["person", "P-003"], b: ["organization", "O-003"] },
  { link: "associates", a: ["person", "P-001"], b: ["person", "P-002"] },
  { link: "vesselsOwned", a: ["organization", "O-001"], b: ["vessel", "9312001"] },
  { link: "vesselsOwned", a: ["organization", "O-002"], b: ["vessel", "9377402"] },
  { link: "aircraftOperated", a: ["organization", "O-003"], b: ["aircraft", "4b1a23"] },
  { link: "involvedVessels", a: ["event", "E-001"], b: ["vessel", "9312001"] },
  { link: "eventLocation", a: ["event", "E-001"], b: ["location", "L-001"] },
  { link: "involvedOrganizations", a: ["event", "E-002"], b: ["organization", "O-002"] },
  { link: "mentionedOrganizations", a: ["document", "D-001"], b: ["organization", "O-001"] },
  { link: "mentionedPersons", a: ["document", "D-001"], b: ["person", "P-001"] },
  { link: "mentionedPersons", a: ["document", "D-002"], b: ["person", "P-002"] },
  { link: "mentionedOrganizations", a: ["document", "D-002"], b: ["organization", "O-002"] },
  { link: "mentionedOrganizations", a: ["document", "D-002"], b: ["organization", "O-003"] },
];

async function seed() {
  const pool = getPool();

  for (const t of OBJECT_TYPES) {
    const res = await pool.query(
      `insert into object_type (api_name, display_name, description, kind, pk_property, title_property)
       values ($1, $2, $3, $4, $5, $6) on conflict (api_name) do nothing returning id`,
      [t.apiName, t.displayName, t.description, t.kind, t.pk, t.title]
    );
    if (!res.rows.length) continue;
    const typeId = res.rows[0].id;
    let pos = 0;
    for (const [api, display, type, searchable, required] of t.props) {
      await pool.query(
        `insert into property_def (object_type_id, api_name, display_name, type, searchable, required, position)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
        [typeId, api, display, type, searchable ?? false, required ?? false, pos++]
      );
    }
    console.log(`object type ${t.apiName}`);
  }

  const typeIds = new Map<string, string>(
    (await pool.query(`select id, api_name from object_type`)).rows.map((r) => [r.api_name, r.id])
  );

  for (const l of LINK_TYPES) {
    await pool.query(
      `insert into link_type (api_name_a_to_b, api_name_b_to_a, display_name, object_type_a, object_type_b, cardinality)
       values ($1, $2, $3, $4, $5, $6) on conflict (api_name_a_to_b) do nothing`,
      [l.aToB, l.bToA, l.display, typeIds.get(l.a), typeIds.get(l.b), l.cardinality ?? "many_to_many"]
    );
  }
  console.log(`${LINK_TYPES.length} link types`);

  for (const a of ACTIONS) {
    await pool.query(
      `insert into action_type (api_name, display_name, description, parameters, submission_criteria, rules)
       values ($1, $2, $3, $4, $5, $6) on conflict (api_name) do nothing`,
      [
        a.apiName,
        a.displayName,
        a.description,
        JSON.stringify(a.parameters),
        JSON.stringify(a.submission_criteria),
        JSON.stringify(a.rules),
      ]
    );
  }
  console.log(`${ACTIONS.length} action types`);

  let objCount = 0;
  for (const o of DEMO_OBJECTS) {
    const res = await pool.query(
      `insert into obj (object_type_id, pk_value, source_props) values ($1, $2, $3)
       on conflict (object_type_id, pk_value) do nothing returning id`,
      [typeIds.get(o.type), o.pk, JSON.stringify(o.props)]
    );
    if (res.rows.length) objCount++;
  }

  const linkTypeIds = new Map<string, string>(
    (await pool.query(`select id, api_name_a_to_b from link_type`)).rows.map((r) => [r.api_name_a_to_b, r.id])
  );
  const objIds = new Map<string, string>(
    (
      await pool.query(
        `select o.id, ot.api_name as type_name, o.pk_value from obj o join object_type ot on ot.id = o.object_type_id`
      )
    ).rows.map((r) => [`${r.type_name}:${r.pk_value}`, r.id])
  );

  let linkCount = 0;
  for (const l of DEMO_LINKS) {
    const res = await pool.query(
      `insert into link_instance (link_type_id, obj_a, obj_b) values ($1, $2, $3)
       on conflict do nothing returning id`,
      [linkTypeIds.get(l.link), objIds.get(l.a.join(":")), objIds.get(l.b.join(":"))]
    );
    if (res.rows.length) linkCount++;
  }

  if (objCount || linkCount) {
    await pool.query(
      `insert into audit_log (actor, category, detail) values ('seed', 'dataLoad', $1)`,
      [JSON.stringify({ objects: objCount, links: linkCount, source: "demo-seed" })]
    );
  }
  console.log(`${objCount} demo objects, ${linkCount} demo links`);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
