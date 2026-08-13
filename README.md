# Tessera

*An experiment in ontology, data layers, and composable analytical products over open data.*

A **tessera** is a single tile in a mosaic. This project is about what happens when you treat open-source data the same way: many small, individually unremarkable fragments — news items, sanctions entries, corporate filings, ship and aircraft positions — assembled into a coherent, queryable picture.

Tessera is a full-stack web platform built to explore three hard architectural problems:

1. **Ontology as data** — object types, links, and actions defined as runtime-editable metadata rather than code, with a single object-set query algebra shared by every surface.
2. **Data layers with memory** — transaction-logged datasets, declared transforms with computed lineage, and analyst edits kept as an overlay above immutable source data.
3. **Products as composition** — analytical apps (explorers, graphs, maps, timelines, dossiers) that users assemble from widgets bound to the ontology, plus an AI layer whose only tools are governed ontology verbs.

## Architecture

```
 L4  AI layer         LLM functions with governed ontology tools; propose-then-promote writes
 L3  Product layer    module builder (widgets + variables + events), graph, map, timeline, dossier
 L2  Ontology         object types / links / actions as metadata; edits overlay; object-set algebra
 L1  Data foundation  sources → syncs → transactional datasets → declared transforms → lineage
 L0  Open sources     GDELT, OpenSanctions, OpenCorporates, RSS, ADS-B, AIS, Wikidata, ACLED
 ──  Cross-cutting    workspaces + roles; sensitivity tags that propagate along lineage; audit
```

Lean stack: **Postgres + TypeScript (Next.js/React) + a worker process**. No Spark, no Kafka, no multi-tenancy machinery — the enterprise patterns rebuilt at hobby scale, keeping the ideas and dropping the bulk.

## Design principles

- **Every claim has provenance.** Property values are append-only and carry their source, author, and timestamp.
- **Merges are reversible.** Entity resolution produces canonical "bags" over preserved constituents; unmerge is first-class.
- **Writes go through actions.** Typed, validated, audited mutations — for humans and models alike.
- **Sensitivity follows derivation.** Tags on sources propagate to everything built from them.
- **The model only asks.** AI reads via granted object queries and writes via declared actions, staged for review.

## Roadmap

| Phase | Focus |
|---|---|
| 0 | Ontology spine: metadata tables, object store with edits overlay, object-set evaluator, actions engine |
| 1 | Data layer: sources, syncs, transactions, first three feeds, transforms, lineage view |
| 2 | Entity resolution and per-value provenance, human review queue |
| 3 | Analyst surfaces: explorer, entity pages, graph, map, timeline, search |
| 4 | Product builder: module JSON, widget registry, variable engine, dossiers |
| 5 | AI layer: ontology-derived tools, staged writes, automations, evals |

## Research

The design is grounded in a deep-research pass over publicly documented platforms in this space — see [docs/research/00-synthesis.md](docs/research/00-synthesis.md) for the synthesis and `docs/research/01–06` for the six detailed slice reports (~80 primary sources).

## Status

Pre-alpha. **All six phases (0–5) of the original roadmap are complete.**

- **Phase 5 — AI layer**: a governed analyst agent over the ontology (`/ai`). Tool schemas are generated from ontology metadata (object types, searchable properties, link traversals, actions); reads go through the shared object-set evaluator; the **only write path is `propose_action`**, which validates via the actions engine and stages a proposal for human review — approve/reject in the proposal queue, where approval applies through the ordinary audited actions engine (propose-then-promote). Plus standing **automations** (object-set count vs threshold → alerts) and a minimal **eval harness** (cases graded on answer content and on write-policy compliance; eval proposals are auto-rejected). Chat requires `ANTHROPIC_API_KEY` in `.env` (model: `claude-opus-5`, override with `TESSERA_MODEL`); refusal fallbacks are enabled via the API's server-side fallback mode. Proposals, automations, and the offline smoke suite work without a key.

- **Phase 0 — ontology spine**: metadata plane, object store with edits overlay, object-set evaluator with search-around pivots and aggregations, actions engine with edit/audit logs, seed OSINT ontology (7 object types, 10 link types, 5 actions), REST API, minimal inspection UI.
- **Phase 1 — data layer**: sources → syncs → transaction-logged datasets → declared transforms → ontology. Live OSINT feeds (RSS world news, GDELT DOC 2.0, OpenSanctions EU-FSF + Swiss SECO) land raw records in append transactions; transforms map them into document/person/organization objects with a `watchlist` tag. Incremental builds via per-input transaction watermarks read from job history; dedupe-by-pk makes every sync idempotent; re-ingestion merges into `source_props` only, so analyst edits always survive (verified by the smoke suite). Pipeline UI at `/data` with lineage, txn history, and run buttons.
- **Phase 4 — product builder**: modules as data. A module is a JSON document — variables (the only state) plus widget instances whose configs bind to variables; the runtime resolves widget data through the shared object-set endpoints and routes every write through declared actions. Nine widgets (stat, bar chart, object table, facet filter, text input, object card, linked objects, markdown with `{{var}}` interpolation, action form auto-generated from action metadata). Config-level filters may bind to variables (`var`), and an empty variable skips its filter — interactivity without an expression engine. The builder at `/modules/[id]/edit` renders config forms generically from registry descriptors, auto-declares referenced variables, and offers live draft preview; publishing snapshots the draft into an immutable `module_version` row (v1, v2, …) with audit. **Dossiers** at `/dossiers`: markdown documents with `@[type:pk|Label]` entity mentions that render as live object links, with a search-to-insert mention picker and side-by-side preview.
- **Phase 3 — analyst surfaces**: five interactive views over the ontology, all sharing the object-set query layer. **Explorer** (`/explore`) with live facet histograms that recompute against active filters and stack into combined queries; **Graph** (`/graph`) — a dependency-free force-directed link view with click-to-search-around expansion, drag, type-colored nodes, and a selection panel; **Map** (`/map`) — an equirectangular bubble map of entity counts by country, clickable through to filtered explorer views; **Timeline** (`/timeline`) — events and documents on one temporal axis grouped by day; **Search** (`/search`) — one query bar across every type's searchable text, grouped by type with match attribution and snippets. Plus an **appearance settings menu**: 7 templates (Auto, Teal Light/Dark, Paper, Slate, Midnight, Amber CRT), 6 interface fonts (System, Grotesk, Humanist, Geometric, Serif, Mono), and 3 density levels — all token-driven, persisted to localStorage, and applied before first paint so there is no flash.
- **Phase 2 — resolution & provenance**: per-value provenance (the "card stack": every property value ever written, with origin, writer, and source ref — populated by both ingest and actions, backfilled for existing data) and non-destructive entity resolution. The matcher blocks on pg_trgm name similarity, scores pairs with alias overlap and exact-match boosts/penalties (birth date, LEI, MMSI…), auto-resolves ≥0.93, queues 0.62–0.93 for human review at `/resolve`, and drops the rest. Resolutions are bags over preserved constituents with transitive merge, canonical flattened reads with per-property attribution and conflict preservation (`/entity/[key]`), and first-class unmerge. In live data, 271 entities appearing on both the EU and Swiss lists unified automatically at ingestion via shared OpenSanctions ids; the matcher handles the remainder.

### Running locally

```bash
npm install
npm run db:up          # Postgres 16 in Docker on port 5442
npm run db:migrate
npm run db:seed        # starter ontology + fictional demo data
npm run db:seed:data   # sources, datasets, syncs, transforms
npm run worker -- all  # sync all live feeds, then build into the ontology
npm run smoke          # ontology engine checks (24)
npm run smoke:data     # data layer checks, offline fixtures (11)
npm run smoke:resolve  # resolution & provenance checks, offline fixtures (18)
npm run smoke:modules  # module builder checks (13)
npm run smoke:ai       # AI layer checks, offline — no API key needed (22)
npm run dev            # UI + API on http://localhost:3011
```

Worker subcommands: `sync [source]`, `build`, `all`, `loop [minutes]`. GDELT rate-limits per IP aggressively; a 429 is recorded on the sync and clears on a later run.

### API sketch

- `GET /api/object-types` — full ontology metadata
- `GET /api/objects/:type` · `GET /api/objects/:type/:pk` · `GET /api/objects/:type/:pk/links/:link`
- `POST /api/object-sets/load` · `POST /api/object-sets/aggregate` — object-set AST (`{type, filter, pivots}`)
- `POST /api/actions/:action/apply` — parameters + optional `validateOnly`

---

*Tessera is an independent educational experiment studying published architectural patterns. It is not affiliated with, endorsed by, or derived from any commercial platform.*
