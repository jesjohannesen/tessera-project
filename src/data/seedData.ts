// Seeds the data layer: three sources (RSS, GDELT, OpenSanctions), their raw
// datasets and syncs, and three transforms mapping raw records into the
// ontology. Idempotent.

import { getPool } from "@/db/client";
import { ensureDataset } from "./datasets";

const SOURCES = [
  {
    apiName: "world_news_rss",
    displayName: "World news (RSS)",
    type: "rss",
    config: {
      feeds: [
        { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC World" },
        { url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera" },
      ],
    },
    dataset: { api: "rss_raw", name: "RSS raw", desc: "Raw items from configured RSS feeds." },
  },
  {
    apiName: "gdelt_monitor",
    displayName: "GDELT monitor",
    type: "gdelt",
    config: { query: '(sanctions OR "shipping fleet" OR smuggling)', maxrecords: 75, timespan: "3d" },
    dataset: { api: "gdelt_raw", name: "GDELT raw", desc: "Articles from the GDELT DOC 2.0 API." },
  },
  {
    apiName: "opensanctions_eu",
    displayName: "OpenSanctions (EU FSF)",
    type: "opensanctions",
    config: { dataset: "eu_fsf", maxRecords: 400 },
    dataset: {
      api: "opensanctions_raw",
      name: "OpenSanctions raw",
      desc: "Targets from the OpenSanctions EU Financial Sanctions Files dataset.",
    },
  },
  {
    apiName: "opensanctions_ch",
    displayName: "OpenSanctions (Swiss SECO)",
    type: "opensanctions",
    config: { dataset: "ch_seco_sanctions", maxRecords: 400 },
    dataset: {
      api: "opensanctions_ch_raw",
      name: "OpenSanctions CH raw",
      desc: "Targets from the OpenSanctions Swiss SECO consolidated list — overlaps the EU list, feeding cross-source entity resolution.",
    },
  },
] as const;

const TRANSFORMS = [
  {
    apiName: "rss_to_documents",
    displayName: "RSS → documents",
    description: "Maps raw RSS items to document objects.",
    inputs: ["rss_raw"],
    outputKind: "ontology",
    entrypoint: "rssToDocuments",
  },
  {
    apiName: "gdelt_to_documents",
    displayName: "GDELT → documents",
    description: "Maps GDELT articles to document objects.",
    inputs: ["gdelt_raw"],
    outputKind: "ontology",
    entrypoint: "gdeltToDocuments",
  },
  {
    apiName: "sanctions_to_entities",
    displayName: "Sanctions → persons & orgs",
    description: "Maps OpenSanctions targets to person and organization objects with a watchlist tag.",
    inputs: ["opensanctions_raw"],
    outputKind: "ontology",
    entrypoint: "sanctionsToEntities",
  },
  {
    apiName: "sanctions_ch_to_entities",
    displayName: "Swiss sanctions → persons & orgs",
    description: "Maps Swiss SECO targets to person and organization objects with a watchlist tag.",
    inputs: ["opensanctions_ch_raw"],
    outputKind: "ontology",
    entrypoint: "sanctionsToEntities",
  },
] as const;

async function seedData() {
  const pool = getPool();

  for (const s of SOURCES) {
    await pool.query(
      `insert into source (api_name, display_name, type, config) values ($1, $2, $3, $4)
       on conflict (api_name) do nothing`,
      [s.apiName, s.displayName, s.type, JSON.stringify(s.config)]
    );
    const sourceId = (
      await pool.query(`select id from source where api_name = $1`, [s.apiName])
    ).rows[0].id;
    const datasetId = await ensureDataset(s.dataset.api, s.dataset.name, s.dataset.desc);
    await pool.query(
      `insert into sync (source_id, dataset_id) values ($1, $2) on conflict do nothing`,
      [sourceId, datasetId]
    );
    console.log(`source ${s.apiName} → ${s.dataset.api}`);
  }

  for (const t of TRANSFORMS) {
    await pool.query(
      `insert into transform (api_name, display_name, description, inputs, output_kind, entrypoint)
       values ($1, $2, $3, $4, $5, $6) on conflict (api_name) do nothing`,
      [t.apiName, t.displayName, t.description, t.inputs, t.outputKind, t.entrypoint]
    );
    console.log(`transform ${t.apiName}`);
  }

  await pool.end();
}

seedData().catch((err) => {
  console.error(err);
  process.exit(1);
});
