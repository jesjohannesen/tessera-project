# Platform Research Synthesis

Deep-research pass over Palantir's public documentation (Foundry, Gotham, AIP, Apollo), August 2026. Six research agents covered: data foundation, ontology, application layer, AI platform, intelligence workflows, and security/deployment. This synthesis extracts the architecture we want to build against — an experiment in ontology, data layers, and composable analytical products over open-source (OSINT) data. It is not a clone effort; it's a study of the strongest published patterns in this space, rebuilt lean.

## 1. How the stack fits together

Palantir's platform is five layers with two cross-cutting concerns:

```
┌─────────────────────────────────────────────────────────┐
│  L4  AI layer (AIP): LLMs as governed, typed functions  │
│      whose only tools are ontology verbs                │
├─────────────────────────────────────────────────────────┤
│  L3  Product layer: Workshop modules, Quiver/Contour    │
│      analysis, Object Explorer, Notepad, Map, dossiers  │
│      — all composing the same "object set" currency     │
├─────────────────────────────────────────────────────────┤
│  L2  Ontology: object types, links, actions, functions  │
│      — schema as data; reads via object-set algebra,    │
│      writes only via declared Actions; edits overlay    │
├─────────────────────────────────────────────────────────┤
│  L1  Data foundation: sources → syncs → transactional   │
│      datasets → declared transforms → derived DAG       │
├─────────────────────────────────────────────────────────┤
│  L0  External systems: ~300 connectors (for us: OSINT   │
│      feeds — GDELT, OpenSanctions, RSS, ADS-B, AIS…)    │
└─────────────────────────────────────────────────────────┘
   Cross-cutting: security (roles + propagating markings,
   audit, checkpoints) and deployment (Apollo: declarative
   converge-to-channel with constraints)
```

Data flows up: raw records become datasets, datasets back object types, objects power apps, apps and AI mutate objects through actions, and action edits flow back down as writeback datasets. Gotham adds the intelligence-analysis grammar on top: entity/event/document triad, non-destructive entity resolution, per-property provenance, graph/map/timeline/dossier surfaces.

## 2. The ten load-bearing ideas

1. **Transaction-logged datasets.** Every dataset is files + schema + an ordered log of typed transactions (SNAPSHOT/APPEND/UPDATE/DELETE). Branching, time travel, incremental computation, and safe aborts all fall out of this one primitive.

2. **Declared transforms → derived DAG.** Pipelines declare inputs and outputs; the platform infers the graph. Lineage (Monocle), orchestration, and impact analysis are views over declarations, never hand-drawn diagrams. Data-quality expectations run *inside* the transaction boundary — bad data aborts the commit.

3. **Ontology as metadata.** Object types, properties, links, and actions are rows, not code. The schema is editable at runtime, versioned, and governed by PR-style proposals. Stable API names (distinct from display names) make codegen and refactor-safe apps possible.

4. **Edits as an overlay.** Actions never rewrite source data. User/analyst edits live in a per-property overlay with declared precedence (edits-win vs latest-timestamp-wins). Source pipelines and human corrections coexist without clobbering each other.

5. **All writes through Actions.** An action = typed parameters + submission criteria + declarative edit rules + side effects. Every mutation is validated, permission-checked, auditable, and UI-auto-generatable. Arbitrary code (function-backed actions) is the escape hatch, not the default.

6. **Object-set algebra as the universal currency.** One query abstraction — filter, search-around (link pivot), set ops, aggregations — shared by every UI surface, function, SDK, and API. This is what makes the tools composable: Explorer hands an object set to the graph, the graph to the map, the map to a dossier.

7. **Non-destructive entity resolution.** (Gotham's crown jewel, and the key OSINT pattern.) Records from different sources referring to the same real-world entity are *resolved* into a bag with a canonical ID — constituents preserved, reads flattened, post-merge writes partitioned to a "winner" — and **unresolve** is first-class. Combined with per-property provenance (every value knows its source document/feed, timestamp, author), wrong merges are recoverable and every claim is traceable.

8. **Apps as reactive variable graphs.** A Workshop module is JSON: variables (the only state), widgets (declare variable inputs/outputs, never talk to each other), events (ordered, fire-and-forget side-effect lists), hierarchical layout with variable-bound visibility. Lazy evaluation: nothing computes until a visible widget needs it. Modules expose a variable interface → every app is an embeddable, URL-initializable component.

9. **LLMs as governed functions over the ontology.** "LLMs do not have direct access to tools; LLMs can only ask to use tools." Reads = object queries over explicitly granted types; writes = pre-declared actions, optionally requiring human confirmation or staged as proposals. Agents, LLM chains, and code share one "function" abstraction — so one eval harness and one automation system covers all of them.

10. **Two-axis security with lineage-aware propagation.** Additive roles (owner/editor/viewer) for collaboration; subtractive, conjunctive sensitivity markings that *follow data derivation* — a pipeline cannot launder sensitivity, and de-marking is a privileged, audited act bound to the marking itself. Checkpoints add justification prompts on dangerous verbs (export, unmark). Apollo applies the same shape to deployment: declare intent, converge under constraints, audit everything.

## 3. What we build (lean mapping)

Target: a full-stack web app — Postgres + TypeScript (Next.js/React) + a worker process — that recreates the *shape* of this stack at hobby scale, sourcing real OSINT feeds.

| Palantir concept | Our lean equivalent |
|---|---|
| Datasets + transactions | `dataset`/`txn`/`record` tables in Postgres; append-only JSONB records keyed by txn range (time travel + branches nearly free) |
| Syncs / Data Connection | Worker jobs per source type (RSS, GDELT, OpenSanctions, ADS-B, AIS…) writing APPEND transactions on schedules |
| Transforms + Monocle | Declared TS transform functions (inputs/outputs in metadata) + topological scheduler + a lineage graph view |
| Ontology (types/links/actions) | Metadata tables; generic `object` instance table with `source_props` + `edit_props` JSONB overlay |
| Funnel / object indexing | Ingest upserts `source_props` by primary key; never touches `edit_props`; GIN indexes for search |
| Object-set algebra | JSON AST (`{type, filter, pivots, ops}`) evaluated server-side; one endpoint for load + aggregate |
| Actions | `action_type` metadata → validate → expand rules → transactional patch + append-only `edit_log` |
| Entity resolution | `resolutions(canonical, winner, members[], confidence, method)`; blocking on hard IDs (IMO, ICAO24, LEI, sanction IDs) + fuzzy names; mid-confidence queue for human review; unresolve = drop the row |
| Provenance | Append-only `property_values` with `source_id`, `doc_span`, `author`, `recorded_at` — the "card stack" |
| Workshop | Module JSON + widget registry (React) + variable dependency store + ordered event lists + `applyAction` |
| Explorer/Graph/Map/Timeline/Dossier | Object browser with facet histograms; Cytoscape/Sigma graph with search-around; MapLibre with geofenced standing searches; vis-timeline; TipTap dossier with live entity mentions |
| AIP | Claude API; tool schemas generated from ontology metadata (granted types → `query_objects`, actions → one tool each); propose-then-promote on writes; eval suites over saved cases |
| Security | Workspaces + 3 roles + sensitivity tags on *sources* that propagate to derived artifacts; append-only audit table; justification prompt on export/tag-removal |
| Apollo | Just: declarative env config, auto-run migrations, refuse deploy on failure |

## 4. Build sequence

- **Phase 0 — Ontology spine.** Metadata tables, object instance store with edits overlay, object-set AST evaluator, actions engine with audit log. CLI/seed with a starter OSINT ontology: Person, Organization, Vessel, Aircraft, Event, Document, Location + links.
- **Phase 1 — Data layer.** Source/sync/dataset/txn tables, worker with 3 first feeds (RSS, GDELT, OpenSanctions), declared transforms, lineage view.
- **Phase 2 — Resolution & provenance.** Per-value provenance, blocking + scoring, review queue UI, canonical flattened reads, unresolve.
- **Phase 3 — Analyst surfaces.** Object explorer with facets, entity pages with source chips, graph with search-around, map with tracks + geofences, timeline, global search.
- **Phase 4 — Product builder.** Module JSON schema, widget registry (~10 widgets), variable engine, event system, publish/version, dossier editor.
- **Phase 5 — AI layer.** Ontology-derived Claude tools, chat surface embedded in modules, staged writes, standing automations (condition → action), minimal eval harness.

## 5. What we deliberately do not build

Spark/Flink compute, connector agents/proxies, virtual-table federation, multi-org tenancy, row/column/cell-level policy engines, custom roles, marketplace machinery, hub/spoke deployment, SIEM export. Each exists for thousand-user enterprise scale; at our scale they're liability. We keep their *ideas* (propagating sensitivity tags, constraints-before-deploy) in miniature.

## 6. Primary sources

See slice reports 01–06 in this directory for ~80 cited Palantir doc URLs (palantir.com/docs/foundry, /docs/gotham, /docs/apollo).
