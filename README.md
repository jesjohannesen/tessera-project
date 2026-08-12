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

Pre-alpha. Repo scaffold and research phase complete; Phase 0 not yet started.

---

*Tessera is an independent educational experiment studying published architectural patterns. It is not affiliated with, endorsed by, or derived from any commercial platform.*
