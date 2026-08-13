// The governed tool layer: tool schemas are generated from ontology metadata,
// reads go through the shared object-set evaluator, and the ONLY write path is
// propose_action — which validates via the actions engine and stages a
// proposal for human review. The model never applies anything itself.

import { getPool } from "@/db/client";
import { getOntology } from "@/ontology/metadata";
import { applyAction } from "@/ontology/actions";
import {
  aggregateObjectSet,
  getObject,
  listLinked,
  loadObjectSet,
} from "@/ontology/objectSet";
import { searchObjects } from "@/search/search";
import { OntologyMeta } from "@/ontology/types";

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Compact digest of the ontology for tool descriptions and the system prompt. */
export function ontologyDigest(meta: OntologyMeta): string {
  const types = meta.types
    .map((t) => {
      const props = t.properties
        .filter((p) => p.searchable || p.apiName === t.pkProperty)
        .map((p) => `${p.apiName}:${p.type}`)
        .join(", ");
      return `- ${t.apiName} (pk ${t.pkProperty}): ${props}`;
    })
    .join("\n");
  const links = meta.links
    .map((l) => `- ${l.apiNameAToB} (${l.objectTypeA}→${l.objectTypeB}), reverse ${l.apiNameBToA}`)
    .join("\n");
  const actions = meta.actions
    .map((a) => `- ${a.apiName}(${a.parameters.map((p) => `${p.apiName}${p.required ? "" : "?"}`).join(", ")}): ${a.description ?? ""}`)
    .join("\n");
  return `Object types (searchable properties):\n${types}\n\nLinks (traversal names):\n${links}\n\nActions (the only write path):\n${actions}`;
}

const FILTER_DESC =
  'Filter AST: {"op":"eq|neq|lt|lte|gt|gte|contains|startsWith","property":string,"value":any} or {"op":"and|or","clauses":[...]} or {"op":"not","clause":...} or {"op":"isNull","property":string}. Only searchable properties are filterable.';

export function buildTools(meta: OntologyMeta): AgentTool[] {
  return [
    {
      name: "query_objects",
      description: `Load objects from the ontology with optional filter and link pivots (search-around). ${FILTER_DESC} Pivots traverse links by their traversal api name.\n\n${ontologyDigest(meta)}`,
      input_schema: {
        type: "object",
        properties: {
          type: { type: "string", description: "Object type api name" },
          filter: { type: "object", description: "Optional filter AST" },
          pivots: {
            type: "array",
            items: {
              type: "object",
              properties: {
                link: { type: "string", description: "Link traversal api name" },
                filter: { type: "object" },
              },
              required: ["link"],
            },
            description: "Optional link pivots, applied in order (max 3)",
          },
          pageSize: { type: "integer", description: "Max objects to return (default 15, max 50)" },
        },
        required: ["type"],
      },
    },
    {
      name: "aggregate_objects",
      description: `Count objects, optionally grouped by a searchable property. ${FILTER_DESC}`,
      input_schema: {
        type: "object",
        properties: {
          type: { type: "string" },
          filter: { type: "object" },
          groupBy: { type: "string", description: "Optional property to group counts by" },
        },
        required: ["type"],
      },
    },
    {
      name: "get_object",
      description: "Fetch one object by type and primary key, with all its properties.",
      input_schema: {
        type: "object",
        properties: { type: { type: "string" }, pk: { type: "string" } },
        required: ["type", "pk"],
      },
    },
    {
      name: "list_linked",
      description: "List objects linked to a given object via a link traversal api name.",
      input_schema: {
        type: "object",
        properties: {
          type: { type: "string" },
          pk: { type: "string" },
          link: { type: "string" },
        },
        required: ["type", "pk", "link"],
      },
    },
    {
      name: "search_objects",
      description: "Full-text search across all object types' searchable text properties.",
      input_schema: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
      },
    },
    {
      name: "propose_action",
      description:
        "Propose an ontology action (the only write path). The proposal is validated and then STAGED FOR HUMAN REVIEW — it is never applied automatically. Include a short rationale. Available actions are listed in query_objects' description.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", description: "Action api name" },
          parameters: { type: "object", description: "Action parameters" },
          rationale: { type: "string", description: "Why this change is warranted" },
        },
        required: ["action", "parameters", "rationale"],
      },
    },
  ];
}

const cap = (s: string, n = 6000) => (s.length > n ? `${s.slice(0, n)}…[truncated]` : s);

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  actor: string
): Promise<string> {
  try {
    switch (name) {
      case "query_objects": {
        const res = await loadObjectSet(
          {
            type: String(input.type),
            filter: input.filter as never,
            pivots: input.pivots as never,
          },
          { pageSize: Math.min(Number(input.pageSize ?? 15), 50) }
        );
        return cap(
          JSON.stringify({
            totalCount: res.totalCount,
            type: res.type,
            objects: res.objects.map((o) => ({ pk: o.pk, title: o.title, props: o.props })),
          })
        );
      }
      case "aggregate_objects": {
        const res = await aggregateObjectSet(
          { type: String(input.type), filter: input.filter as never },
          {
            groupBy: input.groupBy ? { property: String(input.groupBy) } : undefined,
            metrics: [{ fn: "count", as: "n" }],
          }
        );
        return cap(JSON.stringify(res));
      }
      case "get_object": {
        const o = await getObject(String(input.type), String(input.pk));
        return cap(JSON.stringify({ pk: o.pk, title: o.title, props: o.props, version: o.version }));
      }
      case "list_linked": {
        const res = await listLinked(String(input.type), String(input.pk), String(input.link));
        return cap(
          JSON.stringify({
            type: res.type,
            objects: res.objects.map((o) => ({ pk: o.pk, title: o.title })),
          })
        );
      }
      case "search_objects": {
        const groups = await searchObjects(String(input.q), 5);
        return cap(
          JSON.stringify(
            groups.map((g) => ({
              type: g.type,
              total: g.total,
              hits: g.hits.map((h) => ({ pk: h.pk, title: h.title })),
            }))
          )
        );
      }
      case "propose_action": {
        const actionApi = String(input.action);
        const params = (input.parameters ?? {}) as Record<string, unknown>;
        const validation = await applyAction(actionApi, params, {
          actor,
          validateOnly: true,
        });
        if (!validation.valid) {
          return JSON.stringify({ staged: false, errors: validation.errors });
        }
        const res = await getPool().query(
          `insert into proposal (action_api, params, rationale, proposed_by) values ($1, $2, $3, $4) returning id`,
          [actionApi, JSON.stringify(params), String(input.rationale ?? ""), actor]
        );
        await getPool().query(
          `insert into audit_log (actor, category, detail) values ($1, 'proposalCreated', $2)`,
          [actor, JSON.stringify({ proposalId: res.rows[0].id, action: actionApi })]
        );
        return JSON.stringify({
          staged: true,
          proposalId: res.rows[0].id,
          note: "Staged for human review at /ai — it will not be applied unless a person approves it.",
        });
      }
      default:
        return JSON.stringify({ error: `Unknown tool ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

export async function decideProposal(
  id: string,
  decision: "approved" | "rejected",
  actor: string
): Promise<{ status: string; error?: string }> {
  const pool = getPool();
  const res = await pool.query(
    `select * from proposal where id = $1 and status = 'pending'`,
    [id]
  );
  if (!res.rows.length) return { status: "not_pending", error: "Proposal is not pending" };
  const p = res.rows[0];

  if (decision === "rejected") {
    await pool.query(
      `update proposal set status = 'rejected', decided_by = $2, decided_at = now() where id = $1`,
      [id, actor]
    );
    await pool.query(
      `insert into audit_log (actor, category, detail) values ($1, 'proposalRejected', $2)`,
      [actor, JSON.stringify({ proposalId: id })]
    );
    return { status: "rejected" };
  }

  try {
    const applied = await applyAction(p.action_api, p.params, { actor: `proposal:${id}` });
    if (!applied.valid) {
      await pool.query(
        `update proposal set status = 'failed', decided_by = $2, decided_at = now(), error = $3 where id = $1`,
        [id, actor, (applied.errors ?? []).join("; ")]
      );
      return { status: "failed", error: (applied.errors ?? []).join("; ") };
    }
    await pool.query(
      `update proposal set status = 'approved', decided_by = $2, decided_at = now(), action_instance_id = $3 where id = $1`,
      [id, actor, applied.actionInstanceId]
    );
    await pool.query(
      `insert into audit_log (actor, category, detail) values ($1, 'proposalApproved', $2)`,
      [actor, JSON.stringify({ proposalId: id, actionInstanceId: applied.actionInstanceId })]
    );
    return { status: "approved" };
  } catch (err) {
    const message = (err as Error).message;
    await pool.query(
      `update proposal set status = 'failed', decided_by = $2, decided_at = now(), error = $3 where id = $1`,
      [id, actor, message]
    );
    return { status: "failed", error: message };
  }
}
