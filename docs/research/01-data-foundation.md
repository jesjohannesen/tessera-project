# Slice 1: Foundry Data Foundation

## Core primitives

**Source (Data Connection).** A source is a configured connection to one external system (database, cloud storage, SaaS API, SFTP, etc.), created from one of ~300 connectors that encapsulate auth, discovery, and extraction for that system type. A source is a reusable, permissioned credential+endpoint object; syncs, webhooks, exports, and virtual tables all hang off it. Connectivity runs either as a **direct connection** (Foundry reaches the system over the network — the default for cloud/publicly reachable systems) or through an **agent**: Palantir software installed inside the customer's network that acts as a secure intermediary for private/on-prem systems. The currently recommended agent architecture is the "agent proxy" (thin mode), where the agent is only a network tunnel and the sync logic still runs Foundry-side.

**Sync.** A sync is a recurring extraction job bound to a source that lands data in Foundry. Types: **batch syncs** (full pull each run, or incremental pull using a cursor column so only changed rows transfer), **streaming syncs** (continuous ingestion into a stream), **file/media syncs** (files from blob stores into datasets or media sets). Complementing pull-based syncs are push mechanisms: **webhooks** and **listeners** (HTTPS, WebSocket, email, Pub/Sub, Jira, Slack) that let external systems push events in, and REST/API sources for arbitrary HTTP ingestion. **Exports** move data back out for bidirectional flows.

**Dataset.** The atomic storage primitive: a wrapper around files (typically Parquet) plus a schema plus an ordered log of **transactions**. Every write is a transaction of one of four types — SNAPSHOT (replace all contents), APPEND (add files), UPDATE (modify/add files), DELETE (remove files) — so a dataset's current view is the result of replaying its transaction log, and any historical version is addressable. Datasets support **branches** (git-like: `master` plus isolated dev branches carrying their own transaction history), which is the load-bearing trick that makes safe pipeline development possible. Variants: **views** (logical/virtual representations without copying data), **virtual tables** (registered pointers to tables living in Snowflake/BigQuery/Delta/Iceberg, queried in place without ingestion — trades Foundry-side performance and full transform support for zero-copy freshness), **media sets** (unstructured-data container with a schema type such as document/image/audio and a primary format; items are addressed by **media references** so apps and the ontology use media without copying it), and **streams** (below).

**Stream.** A stream = a low-latency **hot buffer** (Kafka-like, keyed/partitioned) + an **archive dataset** into which archiving jobs periodically flush records for durable storage and history. Downstream streaming transforms (Flink-based) read the hot buffer for second-level latency; batch consumers and health checks read the archive. Replay from the archive supports recovery and reprocessing.

**Transform / pipeline.** A transform is a declared computation with explicit input datasets and output datasets; the platform derives the DAG from these declarations, which is what enables lineage, orchestration, and impact analysis. Two authoring surfaces: **Pipeline Builder** (visual: chain built-in transform boards — filter, join, aggregate, expressions, ML/LLM boards — from inputs to outputs; outputs can be datasets, media sets, virtual tables, streams, or ontology objects directly; supports batch, incremental, and streaming modes, and its "deploy" step ships graph changes through a proposal/approval flow) and **Code Repositories** (git-backed repos for Python/PySpark, SQL, Java transforms, plus containers; branches, PRs, protected branches, CI checks that compile the DAG, run unit tests, and show affected datasets before merge).

**Incremental computation.** The `@incremental()` decorator inspects the output's build history to learn input state at the last successful build, then swaps in incremental I/O objects. Read modes: `added` (only rows added since last build), `previous` (output's prior contents), `current` (full input); write modes: `modify` (append/patch output) vs `replace`. Guardrails: a `semantic_version` you bump to force full recomputation; `snapshot_inputs` for reference tables that should always be read whole; `require_incremental=True` to fail rather than silently go full. A run automatically falls back to snapshot mode when an input had a SNAPSHOT transaction, transform logic/semantic version changed, or the output branch is new.

**Build / schedule.** A **build** is one execution of part of the DAG, decomposed into **jobs** (one per transform), run in dependency order with parallelism where possible. **Schedules** trigger builds: time/cron triggers, event triggers (upstream dataset updated), logic conditions, combinable with AND/OR. Target scoping matters: build a single dataset, a "connected" set (target + upstream/downstream within a boundary), or a full pipeline, with exclusions, retries with backoff, and abort semantics (downstream jobs of a failed job skip).

**Health checks and expectations.** Two layers. **Health checks** (Data Health app) are monitoring rules attached to datasets/schedules from the outside: sync status, build status, time-since-last-update, dataset size, schema stability, column null/uniqueness checks; failures raise in-platform + email alerts and color nodes in lineage. **Data expectations** are declared in transform code (`@transform` checks on primary-key uniqueness, schema, row counts, null percentage, allowed values) and are evaluated inside the build; `on_error=FAIL` aborts the transaction so bad data never commits, `WARN` lets it commit and files a Data Health warning. Each check has a unique name tracked across Data Health and Builds.

**Data Lineage (Monocle).** A graph application rendering the dataset dependency DAG. Nodes colored by build status/health; you can expand upstream/downstream, find stale datasets, trace a column, kick off builds, and create/edit schedules directly on the graph. It's the operational cockpit for the data layer.

## Architecture notes

- The stack is layered: **source → sync → raw dataset → transforms → derived datasets → ontology**. Everything between the two ends is "just" datasets + declared transforms; the DAG is inferred from declarations, never hand-drawn.
- The **transaction log on every dataset** is the keystone. It gives you: incremental computation (diff = transactions since last build), branching (a branch is a divergent transaction chain), time travel, and safe aborts (a failed expectation aborts the uncommitted transaction).
- **Branching spans data and code together**: a code branch builds onto the same-named dataset branch, so you preview an entire pipeline change end-to-end before merging. Fallback branches make reads on a missing branch resolve to master.
- Essential vs enterprise bloat: essential = sources, batch+incremental syncs, transactional datasets, declared transforms, event/time schedules, expectations, lineage graph. Bloat for our experiment = agents/agent proxies, Flink streaming, media sets at scale, virtual-table federation, compute-usage metering, marketplace packaging.

## Patterns worth emulating

1. **Transactions as the universal write primitive** — every ingest and transform output is an immutable, typed transaction; incremental logic, lineage, and rollback fall out for free.
2. **Declared inputs/outputs → derived DAG** — never let users wire a graph by hand; infer it and give them the graph as a *view* (Monocle) with build/schedule actions on it.
3. **Expectations inside the transaction boundary** — quality gates that abort the commit, not post-hoc alerts (keep those too, as health checks).
4. **Incremental with an escape hatch** — default to delta processing, auto-fall-back to full recompute on snapshot/logic change, with a `semantic_version` to force it.
5. **Layered project convention** — Data Connection → Datasource (clean) → Transform (canonical) → Ontology projects, one datasource project per source, shared cleanup libraries.
6. **Hot buffer + archive** for anything streaming-ish: serve low latency from a buffer, persist to the same dataset abstraction everything else uses.

## Minimal recreation blueprint

**Data model (Postgres):** `source(id, type, config_json, secret_ref)`; `sync(id, source_id, mode: full|incremental, cursor_expr, schedule)`; `dataset(id, name, project_id)`; `branch(dataset_id, name, head_txn_id)`; `txn(id, dataset_id, branch, type: snapshot|append|update|delete, parent_txn_id, created_at, row_delta_ref)`; rows in per-dataset tables (or one JSONB `record(dataset_id, txn_id, deleted_txn_id, pk, payload)` table — MVCC by txn range gives time travel and branch reads cheaply); `transform(id, name, code_ref, inputs[], output_dataset_id, incremental bool, semantic_version)`; `build(id, trigger, status)`, `job(build_id, transform_id, read_from_txn, wrote_txn_id)`; `expectation(transform_id, check_json, on_error)`; `check_result(job_id, expectation_id, pass)`.

**Execution:** transforms are Python/TS functions receiving `input.added_since(txn)` or `input.current()`, writing via `output.append/replace`; a scheduler (pg-boss/cron) topologically sorts the transform DAG from declared inputs and runs event-triggered builds ("dataset X got a new txn"). OSINT ingestion = "sources" of type RSS/API/scraper writing APPEND transactions.

**API surface:** `POST /sources`, `POST /sources/:id/syncs/:id/run`, `GET /datasets/:id?branch=&at_txn=`, `POST /datasets/:id/branches`, `POST /transforms`, `POST /builds`, `GET /lineage?root=dataset_id`, `GET /health`.

**UI surfaces:** dataset page (preview + schema + transaction history + branch picker), lineage graph (nodes colored by last build/check status, click-to-build), transform editor with declared I/O, build log view, health dashboard.

## Key doc URLs

- https://www.palantir.com/docs/foundry/data-connection/overview/
- https://www.palantir.com/docs/foundry/data-connection/core-concepts
- https://www.palantir.com/docs/foundry/data-integration/datasets/
- https://www.palantir.com/docs/foundry/data-integration/data-pipeline
- https://www.palantir.com/docs/foundry/data-integration/branching
- https://www.palantir.com/docs/foundry/data-integration/schedules
- https://www.palantir.com/docs/foundry/data-integration/streams
- https://www.palantir.com/docs/foundry/data-integration/virtual-tables
- https://www.palantir.com/docs/foundry/data-integration/media-sets
- https://www.palantir.com/docs/foundry/pipeline-builder/overview
- https://www.palantir.com/docs/foundry/code-repositories/overview
- https://www.palantir.com/docs/foundry/building-pipelines/considerations-pb-cr
- https://www.palantir.com/docs/foundry/building-pipelines/recommended-project-structure
- https://www.palantir.com/docs/foundry/transforms-python/incremental-usage
- https://www.palantir.com/docs/foundry/transforms-python/data-expectations-getting-started
- https://www.palantir.com/docs/foundry/data-health/overview
- https://www.palantir.com/docs/foundry/data-lineage/overview
