# Slice 5: Gotham & Intelligence-Analysis Workflows (OSINT relevance)

## Core primitives

**Object model (Gotham RevDB).** Everything is an Object: "a data container for a specific instance of an Object Type" (e.g. `com.palantir.object.employee`). Objects come in three kinds — **Entity** (person, organization, vehicle), **Event** (flight, meeting, transaction), **Document** (PDF, report, message) — a triad confirmed in the Foundry→Gotham type-mapping docs. Objects carry **properties** (typed, namespaced; values can be scalars or structured composites), **links** to other objects, and **media** attachments. Properties, links, and media are all "components" of an object and are individually addressable — each can carry its own security (portion markings / permissions).

**Dynamic ontology.** The schema is data, not code: "The Ontology is entirely customizable and can actually be changed after it has been deployed and data has been integrated." Gotham's ontology is looser than Foundry's: Foundry ontology types are centrally managed and can be *type-mapped* into Gotham's dynamic ontology, with each Foundry object type mapped to Entity/Event/Document.

**Revisioning database.** "Every object … can be thought of as a stack of cards … Each card describes the addition, modification or deletion of a single attribute along with when it happened, who did it, what the security level is and where the information is sourced to." This is per-attribute provenance + audit + ACL in one structure, and it's what makes publish/unpublish, collaboration, and un-merge possible.

**Analyst applications:** **Graph** (link analysis, explore and create connections, layout/Presentation helpers), **Histogram helper** (faceted counts of object types/properties over the current selection — the workhorse for triage), **Timeline helper**, **Map** (geo-search by radius/polygon/route; geospatial searches can be persisted for constant monitoring of an Area of Interest), **Browser** (open any object to see all properties, notes, media, relationships and data sources; read documents and add structure via **tagging**), **Dashboard** (persistent searches: filter-based, path-based, and **SearchAround-based** queries that rerun as data arrives), **Summary** (auto-generates briefs from investigation history, showing "not just analytic conclusions, but also the analytic path that led to them"). Titan-era modules: **Dossier** (real-time collaborative report product), **Gaia** (live geospatial collaboration), **Table** (high-scale search/triage), **Ava** (automated connection discovery for human review), **Custom Object Views** (domain-specific entity pages).

**Geotemporal primitives.** An **Observation** is "a piece of data about something at a specific time and place" (e.g., an AIS ping); a **Track** is "a collection of Observations of the same entity over some period of time." Observations have *static* properties (tail number) vs *live* properties (altitude, heading), conform to an **Observation Spec**, and tracks can be explicitly **linked to ontology objects**. Gaia maps are a **layer tree** whose layers hold elements, ontology objects, and track feeds.

## Architecture notes

**Entity resolution ("object resolution") — the load-bearing pattern.** Gotham does *not* destructively merge. "Object resolution is the act of combining two or more Objects," used to resolve objects from different source systems that refer to the same real-world entity. Mechanics:

- A resolved "bag" has a **`canonicalObjectPrimaryKey`** (the ID the merged entity presents), a **`winnerObjectPrimaryKey`** (created internally when objects are resolved — all *post-merge* writes land on the winner, not on any source object), and **`otherObjectPrimaryKeys`** (the constituents).
- On read, all components of the constituent objects are flattened into the resolved object — union of properties/links/media, each still owned by its source object.
- "Independent histories are preserved and updates to each of the sub-objects will be preserved in case objects ever need to be un-resolved later." **Unresolve** is a first-class operation; post-merge writes can be partitioned back to specific constituents.

**Per-property provenance.** Two reinforcing mechanisms: (1) the revisioning "card stack" records source/author/time/security for every attribute change; (2) "Each Property and Relationship can be sourced back to original document sources, either structured or unstructured." Tagging a document creates properties whose provenance *is* that document span.

**Federation vs ingestion.** Third-party systems can be exposed as **federated sources** with named **namespaces** and declared **query shapes**. Federated objects behave similarly to native objects but are read-only until promoted/imported. This is the search-first-ingest-later pattern: query the external store, and only materialize (then resolve) what matters.

**Search.** One query grammar across the object store: `keyword` full-text, `eq`, ranges, boolean composition, and `geoPointWithin` polygon filters, plus per-federated-source search endpoints.

**Security-as-enabler.** Per-component classification means "share as much information as could possibly be shared without revealing the most sensitive information." Even a small OSINT app benefits from the same slot: swap classification for source-reliability/licensing flags.

## Patterns worth emulating

1. **Non-destructive merge with unmerge.** Canonical/winner/constituents beats row-level dedupe; wrong merges are recoverable, and provenance survives.
2. **Provenance on every property value**, not per record — each value knows its source document/feed, timestamp, and author (human tag vs pipeline).
3. **Document→entity tagging loop**: unstructured text is a first-class object; highlighted spans become entities/properties with back-references.
4. **Histogram-driven triage**: every selection (graph, map, search results) gets live faceted counts you can pivot on.
5. **Search-around** as the core graph gesture: from selected nodes, expand by link type/hops, optionally filtered — plus *persisted* search-arounds that alert when new data matches.
6. **Persistent/standing queries** (Dashboard) including persisted *geofence* searches over an Area of Interest.
7. **Everything is drag-and-drop between apps** — the same object set flows Graph→Map→Timeline→Dossier.
8. **Report generation from investigation history** (Summary/Dossier): the product cites objects, and shows the analytic path.
9. **Observation/Track split** from entity records — movement data stays in its own time-series store, *linked* to entities, not stuffed into properties.

## Minimal recreation blueprint

**Ontology core (Postgres):** `object_types`, `property_types`, `link_types` as rows (dynamic ontology); `objects(id, type, kind: entity|event|document)`; `property_values(id, object_id, property_type, value jsonb, source_id, doc_span, author, valid_time, recorded_at, retracted_at)` — append-only, giving the "card stack" and per-value provenance; `links(a, b, type, source_id, …)` same treatment; `media(object_id, blob, source_id)`.

**Resolution pipeline:** ingest each source record as its own **source object** (never overwrite). Candidate generation: normalized-name + identifier blocking (IMO/ICAO/LEI/registration number exact; name trigram/phonetic fuzzy). Score → auto-resolve above threshold, queue mid-band for human review (propose-then-promote). `resolutions(canonical_id, winner_id, member_ids[], created_by, method, confidence)`; reads flatten members; user edits write to winner; `unresolve` just deletes/edits the resolution row. Canonical view picks display values by source-priority per property (e.g., OpenSanctions beats RSS for aliases).

**Apps (single web UI, shared selection state):** (1) **Graph explorer** — Cytoscape.js/Sigma; node expand = search-around endpoint; side panel = histogram facets of current selection. (2) **Map** — MapLibre; object geopoints as a layer, tracks (AIS/ADS-B) as time-filtered line layers; polygon draw → `geoPointWithin` search → "save as standing search" (geofence alert). (3) **Timeline** — vis-timeline over event objects. (4) **Entity page** — properties grouped with source chips per value, linked entities, source documents, track preview. (5) **Dossier** — TipTap/ProseMirror doc with entity-mention nodes (live links into the ontology) and pinned graph/map/timeline snapshots; export to HTML/PDF. (6) **Search** — Postgres FTS (or Meilisearch) across property values + document text, one query bar with type/property/geo filters.

**Ingestion (document→entity):** fetcher per source → raw doc stored as Document object → extractor (rules + NER via spaCy or an LLM pass) proposes entities/links with `doc_span` provenance → resolution queue. Manual tagging UI on the document view for corrections.

**Candidate free OSINT sources:** **GDELT** (news events/mentions; free REST + BigQuery, 15-min updates); **OpenSanctions** (consolidated sanctions/PEP entities in FollowTheMoney schema; bulk JSON free for non-commercial, yente API self-hostable — its dedupe model is a ready-made resolution testbed); **OpenCorporates** (corporate registries; API key, rate-limited free tier); **RSS/Atom** (unlimited); **ADS-B**: adsb.lol / ADSB.fi / OpenSky Network (free REST, registration/rate limits); **AIS**: aisstream.io (free websocket, registration) — AIS coverage is the weakest free link; **Wikidata** SPARQL for entity backbone/aliases; **ACLED** (registration) for conflict events. Ship (IMO/MMSI), aircraft (ICAO24/registration), company (LEI/registry number), and sanction-entity IDs give strong deterministic resolution keys across these.

## Key doc URLs

- https://www.palantir.com/docs/gotham/api/
- https://www.palantir.com/docs/gotham/api/revdb-resources/objects/object-basics
- https://www.palantir.com/docs/gotham/api/revdb-resources/objects/search-objects
- https://www.palantir.com/docs/gotham/api/revdb-resources/objects/add-object-property
- https://www.palantir.com/docs/gotham/api/revdb-resources/resolution/resolution-basics
- https://www.palantir.com/docs/gotham/api/revdb-resources/federated-sources/federated-source-basics
- https://www.palantir.com/docs/gotham/api/geotime-resources/observations/observation-basics
- https://www.palantir.com/docs/gotham/api/gaia-v2-resources/maps/load-map
- https://www.palantir.com/docs/foundry/object-link-types/enable-gotham-integration
- https://nsarchive.gwu.edu/sites/default/files/documents/3891748/Palantir-The-Palantir-Platform-The-Platform-for.pdf
- https://ctovision.com/the-titan-release-of-palantir-gotham/
