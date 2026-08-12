# Slice 2: Foundry Ontology

## Core primitives

**Object types** — the schema definition of a real-world entity or event ("Employee", "Flight"). Each has: typed **properties** (with metadata, formatting, per-property security), a **primary key** property (unique, required), a **title property** (human display name), an **API name** (stable code identifier) plus an internal RID, a **status** (experimental / active / deprecated), and membership in **type groups** for organization. Object types are grounded in **backing datasources** — datasets, restricted views, or streams; the analogy is object type ≈ dataset schema, object ≈ row, object set ≈ filtered rows. Supporting constructs: **shared properties** (reusable property definitions), **value types** (custom constrained data types with versioning), and **struct types** (composite properties).

**Interfaces** — abstract ontology types describing a shared shape and capabilities across object types (e.g., `Facility` implemented by `Airport`, `ManufacturingPlant`). They bundle interface properties (often via shared properties), link-type constraints, and action-type constraints; interfaces can extend other interfaces, and one object type can implement several. Support is uneven across the platform (full in Ontology Manager and TS v2 Functions; partial in Actions/OSDK).

**Link types** — bidirectional relationship schemas between two object types in the same ontology, with distinct API names per side (`flight.assignedAircraft`, `aircraft.flights`). Cardinalities: one-to-one, one-to-many, many-to-many. Backing: (a) **foreign key** — a property on one type stores the other type's primary key (1:1, many:1); (b) **join table dataset** — required for many-to-many, one column per side's primary key; (c) **object-backed links** — an intermediary object type carries link metadata via two many-to-one links. Multiple distinct link types may connect the same pair of types.

**Actions** — the write path. An action type = parameters + submission criteria + rules + side effects; "a single transaction that changes the properties of one or more objects." **Parameters** are typed user inputs (defaults, filtered dropdowns, security-aware object pickers). **Submission criteria** gate execution (validation/business rules/authorization). **Rules** declare the edits: create object, modify object(s), create-or-modify, delete object(s), create link(s), delete link (link rules apply to many-to-many; FK-backed links are edited by modifying the foreign-key property). Property values map from: parameter, referenced-object property, static value, or contextual value (current user / timestamp). Ordering constraints: can't delete before create/modify, can't modify before create, can't create twice per submission. **Side effects**: notifications, webhooks (before/after edit), pipeline schedule triggers. **Function-backed actions** delegate the edit logic to a Function for arbitrary/conditional multi-object edits, including batched execution.

**Functions** — server-side TypeScript (v1/v2) or Python logic with first-class ontology bindings: read object sets, traverse links, compute aggregations, produce ontology edits. Authored in Code Repositories, published with semantic versions (multiple versions coexist), executed in isolated environments. Uses: function-backed actions, Workshop variables/columns, derived properties, query functions exposed via the API gateway.

**Object sets** — lazy, unordered, single-type collections; the query algebra. Filters (`exactMatch`, phrase/prefix/fuzzy string matches, numeric/date ranges, geo `withinDistanceOf`/`withinPolygon`, boolean/array `contains`, combined with `Filters.and/or/not`); **search-arounds** (pivot to linked types via generated `searchAroundX()` methods, max 3 per load); set ops `union`/`intersect`/`subtract`; `orderBy`/`orderByRelevance`; aggregations via `groupBy`/`segmentBy` with `count/sum/average/min/max/cardinality` and bucketing (`topValues`, `byRanges`, `byDays/byMonth`); `all()` caps at 100k objects; also KNN `nearestNeighbors()` over embeddings. Filtering/sort/aggregation only work on properties flagged **Searchable**.

## Architecture notes

**Dataset → object indexing (Object Storage v2 / Funnel).** The Object Data Funnel service reads from Foundry datasources (datasets, restricted views, streams) **and from user edits produced by Actions**, and indexes both into specialized object databases optimized for retrieval. Three modes: **batch pipelines** (cost-efficient, periodic; changelog datasets are computed, then a *merge changes* job joins changelogs with recent action edits on the object type's primary key), **streaming pipelines** (low latency, continuous), and **direct datasources** (low-latency writes straight into the ontology).

**Edits layer.** Actions never rewrite the backing dataset. The Actions service sends modification instructions to Funnel, which appends them to an offset-tracked queue; offsets are applied live to the indexed data (for object types and many-to-many join-table links), so edits are visible immediately. Periodically, edits are flushed into persistent, Funnel-owned Foundry datasets ("materializations" — effectively writeback datasets usable downstream in pipelines). Funnel triggers merge builds when new source data arrives, or every 6 hours if edits exist.

**Edits vs source-of-truth.** Per-property conflict resolution, two strategies: **apply-user-edits (default)** — an edited property permanently wins over future datasource updates (even if the source row disappears and reappears); unedited properties keep tracking the source. **Apply-most-recent-value** — a timestamp property on the datasource is compared against the edit's timestamp; newer wins. Concurrency: OSv1 tracked full object versions and threw `StaleObject` on conflict; OSv2 version-checks only objects actually used to generate the edit.

**How actions mutate, end to end:** validate submission criteria → evaluate rules (or run backing Function) into an edit set → transactionally apply to the live index → enqueue for merge into persisted edit datasets → fire side effects (notifications/webhooks) → all consuming apps see the change immediately.

**REST API surface (v2, per-object-type routes use API names):** objects — get/list (`GET /api/v2/ontologies/{ontology}/objects/{objectType}` with `pageSize`, `pageToken`, `properties` selection, `orderBy=properties.x:asc`), `search` (POST, where-clause JSON), `aggregate` (POST); object sets — create/load/aggregate from an object-set definition (`POST .../objectSets/loadObjects`, `.../objectSets/aggregate`); linked objects — list/get across a link; actions — `apply`, `applyBatch`, validate-only mode; queries — `execute` (published query functions); plus interfaces, attachments, time-series points, media references.

**OSDK & Developer Console.** From the ontology, Foundry code-generates strongly typed SDKs: TypeScript (npm), Python (pip/conda), Java (Maven), or raw OpenAPI. Generated code carries property names/docs for IDE autocomplete. **Developer Console** manages third-party apps: SDK generation and versioning, OAuth client credentials, and **scoped tokens** limiting the app to the ontology entities it registered for, intersected with each end-user's permissions. SDKs are regenerated/republished when the ontology changes.

**Ontology Manager & governance.** Single management app for object/link/action/interface definitions, roles/permissions, and usage analysis. Changes can go through **branches + proposals** — explicitly analogous to pull requests: a proposal carries the changeset, named reviewers, approval requirements tied to resource/project policies, and tabs for my/in-review/merged/closed; merge integrates the branch into the main ontology.

## Patterns worth emulating

1. **Metadata-driven writes**: actions as declared parameter→rule mappings make every mutation auditable, permission-checkable, and UI-auto-generatable — arbitrary code is the escape hatch (function-backed), not the default.
2. **Edits as an overlay, not in-place mutation**: source data stays immutable; per-property edit precedence gives you both "analyst corrections win" and "sensor is truth" semantics.
3. **Stable API names distinct from display names/RIDs** — enables codegen and refactor-safe apps.
4. **Object-set algebra as the single query language** shared by UI, functions, and REST.
5. **Searchable-flag discipline**: explicit opt-in of properties to the index keeps the search layer predictable.
6. **PR-style ontology proposals** for schema governance.
7. **Interfaces + shared properties** for polymorphic OSINT entities (e.g., `Actor` over Person/Org/Unit).

## Minimal recreation blueprint

**Postgres, two planes.** *Metadata plane:* `object_type(id, api_name, display_name, pk_property, title_property, status, version)`, `property(id, object_type_id, api_name, type, searchable bool, shared_property_id?)`, `interface(id, api_name)` + `interface_property` + `object_type_interface`, `link_type(id, api_name_a, api_name_b, type_a, type_b, cardinality, backing enum('fk','join'), fk_property_id?)`, `action_type(id, api_name, params jsonb, criteria jsonb, rules jsonb, side_effects jsonb)`, `function(id, api_name, version, runtime, entrypoint)`. *Instance plane:* one generic `object(object_type_id, pk_value text, source_props jsonb, edit_props jsonb, deleted bool, version int)` with computed view `props = source_props || edit_props` (that override IS the edits layer); `link(link_type_id, pk_a, pk_b, from_edit bool)`; `edit_log(action_instance_id, object_ref, patch jsonb, actor, ts)` as append-only audit; `action_instance(action_type_id, params jsonb, actor, ts, status)`. Ingest jobs (your "Funnel") upsert `source_props` from OSINT feeds by primary key, never touching `edit_props`. GIN index on `props` for searchable fields; optionally mirror to a search index later.

**API surface (mirror Foundry v2):** `GET /api/objectTypes`, `GET /api/objects/{type}` (paging, orderBy, property select), `POST /api/objects/{type}/search`, `POST /api/objects/{type}/aggregate`, `GET /api/objects/{type}/{pk}/links/{linkApiName}`, `POST /api/actions/{actionType}/apply` (+ `validateOnly`), `POST /api/objectSets/load|aggregate` accepting a JSON object-set AST (`{type, filter, pivots[], ops[]}`). Action apply = validate criteria → expand rules into patches in one DB transaction → write `edit_props`/`link` rows + `edit_log` → dispatch webhooks/notifications.

**Codegen/SDK:** a script reads the metadata tables and emits a TypeScript package — one interface per object type (typed props), a fluent object-set builder (`Client.objects.Report.filter(...).pivotTo("author").aggregate(...)`) compiling to the object-set AST, and one typed function per action (`applyCreateReport({title,...})`). Regenerate on ontology version bump; scope API tokens to (object types, actions) granted per registered app — a poor-man's Developer Console.

## Key doc URLs

- https://www.palantir.com/docs/foundry/ontology/overview/
- https://www.palantir.com/docs/foundry/object-link-types/object-types-overview/
- https://www.palantir.com/docs/foundry/object-link-types/link-types-overview/
- https://www.palantir.com/docs/foundry/object-link-types/create-link-type/
- https://www.palantir.com/docs/foundry/interfaces/interface-overview/
- https://www.palantir.com/docs/foundry/action-types/overview/
- https://www.palantir.com/docs/foundry/action-types/rules/
- https://www.palantir.com/docs/foundry/functions/overview/
- https://www.palantir.com/docs/foundry/functions/api-object-sets
- https://www.palantir.com/docs/foundry/object-indexing/overview
- https://www.palantir.com/docs/foundry/object-edits/how-edits-applied
- https://www.palantir.com/docs/foundry/ontology-sdk/overview/
- https://www.palantir.com/docs/foundry/api/v2/ontologies-v2-resources/
- https://www.palantir.com/docs/foundry/api/ontology-resources/objects/list-objects/
- https://www.palantir.com/docs/foundry/ontologies/review-ontology-proposals
- https://www.palantir.com/docs/foundry/ontologies/branching-ontology
