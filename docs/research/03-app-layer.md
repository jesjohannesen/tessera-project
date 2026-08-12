# Slice 3: Application / Product-Building Layer

## Core primitives

**Workshop** — the flagship no-code operational app builder. Explicit design principle: "Workshop reduces the barrier to entry for application builders by using the Object layer as the primary building block" — the ontology object, not the dataset, is the unit of composition. An app is a **module** containing **widgets**, **variables**, **events**, and a **layout**. Widget categories: core display (Object Table, Object List, Object View, Property List), visualization (XY/Vega/Gantt/Pie charts, Maps, Pivot Table, Timeline, Media Preview), filtering/input (Filter List, Object Dropdown, Text Input, Date Picker, User Select), event-trigger & navigation (Button Group, Tabs, Comments, Media Uploader), plus AIP widgets (AIP Analyst, Chatbot). Writeback goes exclusively through ontology **Actions**; business logic via **Functions on Objects (FOO)**. Modules are versioned with Save vs. Publish as distinct steps, support branching, and are stored in Project folders which define their default permissions.

**Slate** — the older pro-styling app builder: drag-and-drop widgets plus full custom HTML/CSS/JS. Building blocks: widgets, **queries** (read/write to data systems, including sources external to Foundry), **Slate functions** (custom JS logic), events and actions, and per-element CSS. Distinctive niche vs Workshop: pixel-level custom design, and public-internet-facing apps where submitters don't need Foundry accounts.

**Quiver** — point-and-click object and time-series analysis. Building blocks: **cards** (each card is one operation — filter, transform, aggregate, visualize) chained into a dependency graph, organized on **boards** within an analysis; **transform tables** for heavier manipulation. Two modes: object-based analysis ("links between objects are natively represented in the Ontology, so Quiver users do not have to perform joins" — traversal is a **search around**), and time-series analysis with signal-processing functions. Analyses publish as parameterized, interactive **dashboards** embeddable in Workshop and Notepad.

**Contour** — dataset-level (tabular) counterpart to Quiver. An **analysis** contains **paths**: linear sequences of **boards** (filter, join, pivot, visualize) applied to datasets, with an expression language for advanced steps. Suited to large-scale joins/aggregations that object-based tools handle poorly. Results can be saved back as new datasets, and analyses publish as parameterized Contour dashboards.

**Object Explorer** — the zero-configuration discovery surface: keyword search plus property filters over the ontology, producing **object sets**. Users pivot via linked object types, drill down inside preset/configurable visualizations (charts, maps), compare object sets, run bulk Actions (writeback), save **Explorations** (re-run live on revisit), export, or hand the object set to Quiver. Individual objects open in **Object Views** — themselves configurable, versioned pages that can embed Workshop modules as tabs.

**Notepad** — collaborative rich-text documents with **live object references**: structured links to embedded objects/resources that stay connected to the ontology rather than copying data. Embeds widgets from Contour, Quiver, Object Explorer; supports **templates** (blueprints with configurable inputs for generated reports) and point-in-time **content freezing**.

**Map** — geospatial/geotemporal app: ontology objects with geo properties render directly as **layers** (Layer Editor); bounding-box and polygon-intersection search; timeline playback of movements/events; shape drawing and geospatial Actions; saved/shared maps; **map templates embeddable in Workshop as widgets**.

**Marketplace / Foundry DevOps** — packaging and distribution. A **product** is authored in DevOps by adding **outputs** (the resources Marketplace recreates on install); dependency resolution is automatic — "add the furthest downstream resources first": package the Workshop module and DevOps pulls in its object types, Actions, Functions, and backing datasets. Products are versioned, published to **stores**, and installed via guided installation with release channels and automatic upgrades.

**Developer Console + OSDK** — the pro-code escape hatch. A **custom application** = OAuth authorization client + generated **Ontology SDK** (TypeScript/Python/Java, or OpenAPI) + auto-generated per-app API docs + optional Foundry web hosting. The SDK is typed codegen from a selected subset of ontology resources. Tokens are scoped to the app's approved entities **intersected with the user's own permissions**.

## Architecture notes

Workshop's runtime is a **reactive variable graph wired to a widget tree, with side effects funneled through events and Actions**:

- **Variables** are the only state. Types: string, numeric, boolean, date, timestamp, array, struct, geopoint, geoshape, time series set, **object set**, and **object set filter**. Definition methods: static; **object set definition** (object type + filters + link traversals); **object property**; **object set aggregation**; **function-backed** (computed by a FOO); **variable transformation** (chain of common ops referencing other variables).
- **Reactivity**: default recompute is automatic when any upstream dependency changes; alternatives are event-triggered and load-plus-event-triggered. Crucially, computation is **lazy** — variables recompute only when a visible widget or layout displays them; anything on a hidden page/tab/overlay stays uncomputed.
- **Widgets** declare variable inputs in configuration and write variable outputs through interaction (e.g., Object Table row selection sets an object-set variable). Data flow is entirely mediated by variables; widgets never talk to each other directly.
- **Events** are ordered side-effect lists attached to widget triggers. Event types: variable events (set/reset/recompute, stream LLM response into variable), layer events (open/close overlay), layout events (switch page/tab), application events (open module/analysis/Explorer), data/appearance events, AIP events, and — the writeback path — triggering ontology **Actions**. Semantics: "events execute sequentially based on configuration order" but do **not** await downstream recomputation — explicitly fire-and-forget.
- **Layout** is hierarchical: header → pages → sections (columns, rows, tabs, flow, toolbar, **loop** — iterate a section per element of an object set or array) → widgets, plus overlays (drawers/modals with variable-based visibility). **Variable-backed layouts** bind section visibility/content to variable state.
- **Composition/interface**: a module's **module interface** is the set of variables given an external ID and exposed for (a) initialization from URL query params and (b) mapping from a parent module's variables when embedded — the parent's definition wins, giving shared state across nested modules.
- **Permissions**: apps confer no data access. The module inherits default permissions from its Project folder; ontology object/property-level security governs what each viewer sees; Actions enforce their own submission criteria; OSDK tokens are scoped app ∩ user.

## Patterns worth emulating

1. **Object set as the universal currency** — every tool consumes/produces the same "object set" abstraction, making tools composable (Explorer → Quiver → embedded dashboard → Workshop).
2. **All writes through declared Actions** — apps never mutate data directly.
3. **Links replace joins** — the ontology pre-materializes relationships, so "search around" is a click, not a join spec.
4. **Two-speed builder ladder** — no-code (Workshop) and pro-code (OSDK/React) share the same ontology, Actions, and permissions.
5. **Lazy, declarative reactivity** with explicit recompute policies per variable.
6. **Module interface = app API** — URL-initializable, embeddable modules make every app a component.
7. **Package-by-downstream-root** DevOps products with automatic dependency walking.

## Minimal recreation blueprint

- **Module document (JSON)**: `{ id, version, interface: [{externalId, variableId}], variables: [...], layout: {...}, pages: [...] }`. Variables: `{ id, type, definition: { kind: "static" | "objectSetDefinition" | "aggregation" | "transform" | "function", ... }, recompute: "auto" | "event" }`. Layout: recursive nodes `{ kind: "columns" | "tabs" | "loop" | "widget", visibleWhen?: exprRef, children | widgetRef }`.
- **Widget registry**: React components registered as `{ type, configSchema (zod), inputs: {name → variableType}, outputs, emits: [eventTriggers] }`; renderer walks the layout tree, resolves each widget's inputs from a variable store, and passes an `emit(trigger)` callback.
- **Variable engine**: a dependency graph (Jotai atoms or hand-rolled topological store) where object-set variables compile to backend queries (ontology API: `objectType + filters + traversals`), with lazy evaluation keyed on mounted widgets and per-variable recompute policy.
- **Events**: ordered arrays `[{on: "click", do: [{type: "setVariable" | "openOverlay" | "navigate" | "applyAction", params}]}]` executed sequentially, non-blocking.
- **Actions**: server-defined mutations invoked via one `applyAction(actionId, params)` endpoint; never expose raw writes to widgets.
- **Permissions**: resolve object-set queries server-side under the caller's identity; module JSON carries no ACLs of its own.
- **Publishing**: immutable versioned module JSON (draft → published pointer), plus a "product" manifest that snapshots a module and the ontology types/actions it references.

## Key doc URLs

- https://www.palantir.com/docs/foundry/workshop/overview
- https://www.palantir.com/docs/foundry/workshop/concepts-variables
- https://www.palantir.com/docs/foundry/workshop/concepts-events
- https://www.palantir.com/docs/foundry/workshop/concepts-layouts
- https://www.palantir.com/docs/foundry/workshop/module-interface
- https://www.palantir.com/docs/foundry/slate/overview
- https://www.palantir.com/docs/foundry/quiver/overview
- https://www.palantir.com/docs/foundry/contour/overview
- https://www.palantir.com/docs/foundry/object-explorer/overview
- https://www.palantir.com/docs/foundry/notepad/overview
- https://www.palantir.com/docs/foundry/map/overview
- https://www.palantir.com/docs/foundry/marketplace/overview
- https://www.palantir.com/docs/foundry/foundry-devops/create-products
- https://www.palantir.com/docs/foundry/developer-console/overview
- https://www.palantir.com/docs/foundry/ontology-sdk/overview
