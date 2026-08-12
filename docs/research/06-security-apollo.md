# Slice 6: Security/Governance Model + Apollo

## Core primitives

**Security/governance (Foundry)**

- **Organization** — hard multi-tenancy boundary. Each user has exactly one primary org (guest membership in others is possible). Orgs "enforce strict silos between groups of users and resources" and protect a wider scope than markings: spaces, ontologies, projects, users, groups, tag categories. Access to a project requires being a member or guest of at least one org applied to it.
- **Space** (formerly namespace) — high-level container of projects sharing one ontology and purpose; the unit where orgs are applied. Multi-org spaces enable controlled cross-org collaboration.
- **Project** — the fundamental security and organizational unit ("buckets of shared work"). Role grants at project level cascade to all contained folders/files. Cross-project data use goes through **references** (wrappers around upstream resources); builds must keep inputs/outputs in one project.
- **Roles / role grants (discretionary)** — four defaults: **Owner > Editor > Viewer > Discoverer**. Each role can grant its own level or lower. Best practice: grant to groups at project level; projects can disable resource-level grants entirely. Roles are customizable per enrollment. Access requests let non-members petition with context.
- **Markings (mandatory)** — centrally administered labels defining eligibility criteria. Conjunctive (AND) semantics: a user must hold *all* markings on a resource. They propagate two ways: (1) file-hierarchy inheritance, and (2) **data-dependency inheritance** — every derived resource assumes upstream markings unless explicitly removed, which requires the special **Expand Access** permission *on the marking itself* — even Owners can't strip a marking via role power. Marking application/removal is a "sensitive action" because it re-propagates downstream immediately.
- **Restricted views / granular policies** — row-level security as a wrapper over a backing dataset. Policies compare user attributes (group/org/marking membership by UUID, never by name) against column values. A marking-backed variant reads a STRING ARRAY column of marking UUIDs per row. Restricted views cannot be transform inputs, but can back ontology object types. Docs warn against `NOT` conditions on membership attributes (scoped tokens may lack attributes → accidental over-grant).
- **Object/property security policies (ontology)** — object policies = row-level, property policies = column-level; together, cell-level security. By default policies inherit mandatory controls from backing datasources, but once configured, users *don't* need datasource Viewer access — the policy becomes the authority. Failing a property policy yields a null value, not an error. A non-primary-key property belongs to at most one property policy; primary keys to none. Materialization applies the most-restrictive combination of all sources and policies.
- **Checkpoints (purpose/justification layer)** — a checkpoint is "a prompt that asks a user to provide a justification for an interaction"; configurable across 60+ interaction types (export, download, marking removal, etc.). Each produces a **checkpoint record**: timestamp, user, justification, checkpoint type, affected resources and markings. Users see their own history; admins review at org/space scope, with async approvals via an Approvals app.
- **Audit logs** — every action recorded as who/what/when/where. Current **audit.3 schema** is category-based (not per-service event names): `dataExport`, `dataLoad`, `userLogin`, `tokenGeneration`, plus `eventId`, `categories`, `requestFields`/`resultFields`, `result`. ~15-minute latency, direct API pull for SIEM, or export to in-platform datasets (retention up to 730 days).

**Apollo**

- Continuous-deployment platform for shipping products to SaaS, on-prem, edge, and classified/air-gapped environments. **Hub/spoke**: a central Hub's **Orchestration Engine** decides changes; **Agents** in each Spoke's control plane poll for **Plans**, execute, and report **Reported State** back.
- **Declarative targeting**: an Entity (installed instance) is defined by *product + release channel*, never a pinned version. Apollo converges it to the newest channel release that passes all constraints.
- **Release channels**: defaults DEV → RELEASE_CANDIDATE → RELEASE; promotion is automatic (version format), manual, or via configured pipelines gated on labels and health metrics.
- **Plans & constraints**: Plans are discrete units of work (install, upgrade, config change, secret rotation, uninstall). Constraints gate execution: maintenance windows, product dependency version ranges, suppression windows (auto-created on failure), artifact-existence checks. Failed plans auto-suppress the entity; rollback plans are allowed through auto-suppressions but never through human-created ones.

## Architecture notes

The load-bearing idea is the **mandatory/discretionary split with lineage-aware propagation**. Discretionary access (roles) only ever *expands* within a container and follows the file tree. Mandatory controls (markings, orgs) *restrict*, combine conjunctively, and follow **data flow**: any dataset derived from a marked input inherits the marking automatically, so a pipeline can't launder sensitivity. Removal is a privileged, audited act tied to the marking, not the resource. Row/column policies then sit *on top of* this at read time. The ontology respects underlying data permissions *by default* (datasource ACLs + inherited markings flow to objects), with an explicit, auditable opt-out when object-level policies take over. Checkpoints and audit.3 close the loop: high-risk interactions require recorded justification, and every action lands in a category-typed log designed for external SIEM consumption.

Apollo's core idea is the same shape applied to deployment: humans declare intent (channel subscriptions, constraints, maintenance windows); an engine computes Plans; nothing executes unless every constraint passes; everything is visible before it happens and recorded after.

## Patterns worth emulating

1. **Two-axis access control**: additive roles for collaboration, subtractive conjunctive tags for sensitivity. Never let a resource owner remove a sensitivity tag — bind that right to the tag.
2. **Sensitivity follows derivation**: outputs inherit the union of input tags automatically; de-marking is an explicit, logged, privileged event.
3. **Deny-by-container**: permissions attach to workspaces/projects, not individual artifacts; sub-resource grants are optional and disableable.
4. **References instead of copies** for cross-boundary reuse — access is re-checked at the boundary, no data duplication.
5. **Justification prompts on a small set of dangerous verbs** (export, share-out, tag removal) with reviewable records — cheap, high-value governance.
6. **Category-typed audit events** ("dataExport") rather than per-endpoint event names — queries survive refactors.
7. **UUID-based policy subjects** (never names) and no negative membership conditions.
8. From Apollo: **declare channel, not version**; migrations/config changes as explicit reviewable "plans"; auto-halt on failure with manual-override rollback.

## Minimal recreation blueprint

For a small multi-user OSINT app (Postgres + web app):

- **Tables**: `workspaces`, `users`, `memberships(workspace_id, user_id, role)` with roles `owner|editor|viewer` (drop Discoverer), `sensitivity_tags(id, name, description)`, `tag_grants(tag_id, user_id, can_expand bool)`, `resource_tags(resource_id, tag_id, inherited_from resource_id nullable)`, `audit_log(id, ts, user_id, category, resource_id, request_json, result)`.
- **Semantics**: access = (workspace role ≥ required) AND (user holds *all* tags on resource). When a derived artifact is created from sources, copy the union of source tags with `inherited_from` set; removing an inherited tag requires `can_expand` on that tag and writes a `tagRemoved` audit row.
- **Sensitivity at the source level**: tag OSINT *sources* and let tags flow to everything built on them — the single highest-leverage Palantir idea for OSINT.
- **One justification checkpoint**: on export/download and tag removal, require a free-text reason stored in the audit row. Nothing fancier.
- **Audit as an append-only table** with ~8 fixed categories (`login`, `dataLoad`, `dataExport`, `tagApplied`, `tagRemoved`, `roleGranted`, `resourceCreated`, `resourceDeleted`).
- **Apollo takeaways only**: env config via one declarative file per environment, versioned DB migrations that run automatically on deploy, tagged releases promoted dev → prod (two "channels"), and refuse deploy if migrations fail — constraints before execution.
- **Explicitly do NOT build**: organizations/multi-tenancy silos, guest membership, row/column/cell-level policies, restricted views, granular policy engines, custom roles, scoped sessions, access-request workflows, SIEM export APIs, classification (CBAC), or any hub/spoke deployment machinery. Each exists to serve thousands of users across legal boundaries; at small scale they are pure liability.

## Key doc URLs

- https://www.palantir.com/docs/foundry/security/overview
- https://www.palantir.com/docs/foundry/security/projects-and-roles/
- https://www.palantir.com/docs/foundry/security/orgs-and-spaces/
- https://www.palantir.com/docs/foundry/security/markings/
- https://www.palantir.com/docs/foundry/security/restricted-views/
- https://www.palantir.com/docs/foundry/object-permissioning/overview
- https://www.palantir.com/docs/foundry/object-permissioning/object-security-policies
- https://www.palantir.com/docs/foundry/checkpoints/overview/
- https://www.palantir.com/docs/foundry/security/audit-logs-overview
- https://www.palantir.com/docs/apollo/
- https://www.palantir.com/docs/apollo/core/how-apollo-works/index.html
- https://www.palantir.com/docs/apollo/core/release-channels
- https://www.palantir.com/docs/apollo/core/plans-and-constraints
