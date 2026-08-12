import { getPool } from "@/db/client";
import {
  ActionTypeMeta,
  ApiError,
  LinkTypeMeta,
  ObjectTypeMeta,
  OntologyMeta,
} from "./types";

export async function getOntology(): Promise<OntologyMeta> {
  const pool = getPool();
  const [typeRows, propRows, linkRows, actionRows] = await Promise.all([
    pool.query(`select * from object_type order by api_name`),
    pool.query(`select * from property_def order by object_type_id, position, api_name`),
    pool.query(
      `select lt.*, a.api_name as type_a_name, b.api_name as type_b_name
       from link_type lt
       join object_type a on a.id = lt.object_type_a
       join object_type b on b.id = lt.object_type_b
       order by lt.display_name`
    ),
    pool.query(`select * from action_type order by api_name`),
  ]);

  const types: ObjectTypeMeta[] = typeRows.rows.map((t) => ({
    id: t.id,
    apiName: t.api_name,
    displayName: t.display_name,
    description: t.description ?? undefined,
    kind: t.kind,
    pkProperty: t.pk_property,
    titleProperty: t.title_property,
    status: t.status,
    properties: propRows.rows
      .filter((p) => p.object_type_id === t.id)
      .map((p) => ({
        apiName: p.api_name,
        displayName: p.display_name,
        description: p.description ?? undefined,
        type: p.type,
        searchable: p.searchable,
        required: p.required,
        position: p.position,
      })),
  }));

  const links: LinkTypeMeta[] = linkRows.rows.map((l) => ({
    id: l.id,
    apiNameAToB: l.api_name_a_to_b,
    apiNameBToA: l.api_name_b_to_a,
    displayName: l.display_name,
    objectTypeA: l.type_a_name,
    objectTypeB: l.type_b_name,
    cardinality: l.cardinality,
  }));

  const actions: ActionTypeMeta[] = actionRows.rows.map((a) => ({
    id: a.id,
    apiName: a.api_name,
    displayName: a.display_name,
    description: a.description ?? undefined,
    parameters: a.parameters,
    submissionCriteria: a.submission_criteria,
    rules: a.rules,
    status: a.status,
  }));

  return { types, links, actions };
}

export function requireType(meta: OntologyMeta, apiName: string): ObjectTypeMeta {
  const t = meta.types.find((t) => t.apiName === apiName);
  if (!t) throw new ApiError(404, `Unknown object type: ${apiName}`);
  return t;
}

export function requireAction(meta: OntologyMeta, apiName: string): ActionTypeMeta {
  const a = meta.actions.find((a) => a.apiName === apiName);
  if (!a) throw new ApiError(404, `Unknown action: ${apiName}`);
  return a;
}

/** Resolve a link api name to its link type plus the traversal direction. */
export function resolveLink(
  meta: OntologyMeta,
  linkApiName: string
): { link: LinkTypeMeta; from: "a" | "b" } {
  for (const l of meta.links) {
    if (l.apiNameAToB === linkApiName) return { link: l, from: "a" };
    if (l.apiNameBToA === linkApiName) return { link: l, from: "b" };
  }
  throw new ApiError(404, `Unknown link: ${linkApiName}`);
}
