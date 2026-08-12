// The actions engine: the only write path into the instance plane.
// Flow: validate parameters → evaluate submission criteria → expand rules into
// edits inside one transaction → record edit_log + action_instance + audit.
// Actions write ONLY edit_props — source_props belongs to ingest (Phase 1).

import { PoolClient } from "pg";
import { getPool } from "@/db/client";
import { getOntology, requireAction, requireType, resolveLink } from "./metadata";
import {
  ActionParameter,
  ActionTypeMeta,
  ApiError,
  OntologyMeta,
  PropSource,
} from "./types";

interface ResolvedObjectRef {
  objId: string;
  pk: string;
  typeApiName: string;
}

interface ExecContext {
  actor: string;
  params: Record<string, unknown>;
  objectRefs: Map<string, ResolvedObjectRef>;
  /** Objects created earlier in this same action, keyed by objectType:pk */
  created: Map<string, string>;
}

export interface AppliedEdit {
  editType: string;
  objectType?: string;
  pk?: string;
  link?: string;
  patch?: Record<string, unknown>;
}

export interface ApplyResult {
  valid: boolean;
  errors?: string[];
  actionInstanceId?: string;
  edits?: AppliedEdit[];
}

function checkParamType(def: ActionParameter, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  switch (def.type) {
    case "string":
    case "date":
    case "timestamp":
    case "object_ref":
      return typeof value === "string" ? null : `${def.apiName} must be a string`;
    case "integer":
      return Number.isInteger(value) ? null : `${def.apiName} must be an integer`;
    case "double":
      return typeof value === "number" ? null : `${def.apiName} must be a number`;
    case "boolean":
      return typeof value === "boolean" ? null : `${def.apiName} must be a boolean`;
    case "string_array":
      return Array.isArray(value) && value.every((v) => typeof v === "string")
        ? null
        : `${def.apiName} must be an array of strings`;
    default:
      return null;
  }
}

function evaluateCriteria(
  action: ActionTypeMeta,
  params: Record<string, unknown>
): string[] {
  const errors: string[] = [];
  for (const c of action.submissionCriteria) {
    const v = params[c.param];
    switch (c.op) {
      case "nonEmpty":
        if (v === undefined || v === null || String(v).trim() === "")
          errors.push(c.message);
        break;
      case "regex":
        if (typeof v === "string" && !new RegExp(String(c.value)).test(v))
          errors.push(c.message);
        break;
      case "oneOf":
        if (v !== undefined && Array.isArray(c.value) && !c.value.includes(v))
          errors.push(c.message);
        break;
      case "maxLength":
        if (typeof v === "string" && v.length > Number(c.value))
          errors.push(c.message);
        break;
    }
  }
  return errors;
}

function resolveSource(src: PropSource, ctx: ExecContext): unknown {
  switch (src.kind) {
    case "parameter":
      return ctx.params[src.param];
    case "static":
      return src.value;
    case "context":
      return src.value === "currentUser" ? ctx.actor : new Date().toISOString();
  }
}

async function resolveEndpoint(
  client: PoolClient,
  meta: OntologyMeta,
  ctx: ExecContext,
  param: string,
  expectedType: string
): Promise<ResolvedObjectRef> {
  const existing = ctx.objectRefs.get(param);
  if (existing) {
    if (existing.typeApiName !== expectedType)
      throw new ApiError(
        400,
        `Parameter ${param} references a ${existing.typeApiName}, expected ${expectedType}`
      );
    return existing;
  }
  // The param may point at an object created earlier in this same action.
  const pk = ctx.params[param];
  if (typeof pk !== "string")
    throw new ApiError(400, `Parameter ${param} must reference an object`);
  const createdId = ctx.created.get(`${expectedType}:${pk}`);
  if (createdId) return { objId: createdId, pk, typeApiName: expectedType };
  const type = requireType(meta, expectedType);
  const res = await client.query(
    `select id from obj where object_type_id = $1 and pk_value = $2 and not deleted`,
    [type.id, pk]
  );
  if (!res.rows.length)
    throw new ApiError(404, `${expectedType} ${pk} not found`);
  return { objId: res.rows[0].id, pk, typeApiName: expectedType };
}

export async function applyAction(
  actionApiName: string,
  params: Record<string, unknown>,
  opts: { actor?: string; validateOnly?: boolean } = {}
): Promise<ApplyResult> {
  const actor = opts.actor ?? "local";
  const meta = await getOntology();
  const action = requireAction(meta, actionApiName);
  if (action.status === "deprecated")
    throw new ApiError(400, `Action ${actionApiName} is deprecated`);

  // 1. Parameter validation
  const errors: string[] = [];
  for (const def of action.parameters) {
    const v = params[def.apiName];
    if (def.required && (v === undefined || v === null || v === "")) {
      errors.push(`${def.apiName} is required`);
      continue;
    }
    const typeErr = checkParamType(def, v);
    if (typeErr) errors.push(typeErr);
  }
  const unknownParams = Object.keys(params).filter(
    (k) => !action.parameters.some((p) => p.apiName === k)
  );
  for (const k of unknownParams) errors.push(`Unknown parameter: ${k}`);

  // 2. Submission criteria
  errors.push(...evaluateCriteria(action, params));

  if (errors.length) {
    if (!opts.validateOnly) {
      await getPool().query(
        `insert into action_instance (action_type_id, actor, params, status, error) values ($1, $2, $3, 'rejected', $4)`,
        [action.id, actor, JSON.stringify(params), errors.join("; ")]
      );
    }
    return { valid: false, errors };
  }
  if (opts.validateOnly) return { valid: true };

  // 3. Execute rules in one transaction
  const pool = getPool();
  const client = await pool.connect();
  const ctx: ExecContext = {
    actor,
    params,
    objectRefs: new Map(),
    created: new Map(),
  };
  const edits: AppliedEdit[] = [];

  try {
    await client.query("begin");

    // Resolve object_ref parameters up front (against committed state).
    for (const def of action.parameters) {
      if (def.type === "object_ref" && typeof params[def.apiName] === "string") {
        if (!def.objectType)
          throw new ApiError(500, `Parameter ${def.apiName} lacks objectType`);
        ctx.objectRefs.set(
          def.apiName,
          await resolveEndpoint(client, meta, ctx, def.apiName, def.objectType)
        );
      }
    }

    const actionInstance = await client.query(
      `insert into action_instance (action_type_id, actor, params, status) values ($1, $2, $3, 'applied') returning id`,
      [action.id, actor, JSON.stringify(params)]
    );
    const actionInstanceId: string = actionInstance.rows[0].id;

    for (const rule of action.rules) {
      switch (rule.type) {
        case "create_object": {
          const type = requireType(meta, rule.objectType);
          const pk = resolveSource(rule.pkFrom, ctx);
          if (typeof pk !== "string" || !pk)
            throw new ApiError(400, `Missing primary key for new ${rule.objectType}`);
          const props: Record<string, unknown> = {};
          for (const [propName, src] of Object.entries(rule.properties)) {
            if (!type.properties.some((p) => p.apiName === propName))
              throw new ApiError(500, `Rule writes unknown property ${rule.objectType}.${propName}`);
            const v = resolveSource(src, ctx);
            if (v !== undefined) props[propName] = v;
          }
          props[type.pkProperty] = pk;
          for (const p of type.properties) {
            if (p.required && (props[p.apiName] === undefined || props[p.apiName] === null))
              throw new ApiError(400, `${rule.objectType}.${p.apiName} is required`);
          }
          const inserted = await client.query(
            `insert into obj (object_type_id, pk_value, edit_props) values ($1, $2, $3)
             on conflict (object_type_id, pk_value) do nothing returning id`,
            [type.id, pk, JSON.stringify(props)]
          );
          if (!inserted.rows.length)
            throw new ApiError(409, `${rule.objectType} ${pk} already exists`);
          const objId = inserted.rows[0].id;
          ctx.created.set(`${rule.objectType}:${pk}`, objId);
          await client.query(
            `insert into edit_log (action_instance_id, obj_id, edit_type, patch) values ($1, $2, 'create_object', $3)`,
            [actionInstanceId, objId, JSON.stringify(props)]
          );
          edits.push({ editType: "create_object", objectType: rule.objectType, pk, patch: props });
          break;
        }
        case "modify_object": {
          const type = requireType(meta, rule.objectType);
          const target = await resolveEndpoint(client, meta, ctx, rule.targetParam, rule.objectType);
          const patch: Record<string, unknown> = {};
          for (const [propName, src] of Object.entries(rule.properties)) {
            if (!type.properties.some((p) => p.apiName === propName))
              throw new ApiError(500, `Rule writes unknown property ${rule.objectType}.${propName}`);
            const v = resolveSource(src, ctx);
            if (v !== undefined) patch[propName] = v;
          }
          if (patch[type.pkProperty] !== undefined)
            throw new ApiError(400, `Cannot modify primary key property`);
          if (Object.keys(patch).length) {
            await client.query(
              `update obj set edit_props = edit_props || $2::jsonb, version = version + 1, updated_at = now() where id = $1`,
              [target.objId, JSON.stringify(patch)]
            );
            await client.query(
              `insert into edit_log (action_instance_id, obj_id, edit_type, patch) values ($1, $2, 'modify_object', $3)`,
              [actionInstanceId, target.objId, JSON.stringify(patch)]
            );
          }
          edits.push({ editType: "modify_object", objectType: rule.objectType, pk: target.pk, patch });
          break;
        }
        case "delete_object": {
          const target = await resolveEndpoint(client, meta, ctx, rule.targetParam, rule.objectType);
          await client.query(
            `update obj set deleted = true, version = version + 1, updated_at = now() where id = $1`,
            [target.objId]
          );
          await client.query(
            `insert into edit_log (action_instance_id, obj_id, edit_type) values ($1, $2, 'delete_object')`,
            [actionInstanceId, target.objId]
          );
          edits.push({ editType: "delete_object", objectType: rule.objectType, pk: target.pk });
          break;
        }
        case "create_link":
        case "delete_link": {
          const { link, from } = resolveLink(meta, rule.linkType);
          const typeOfA = from === "a" ? link.objectTypeA : link.objectTypeB;
          const typeOfB = from === "a" ? link.objectTypeB : link.objectTypeA;
          const endA = await resolveEndpoint(client, meta, ctx, rule.aParam, typeOfA);
          const endB = await resolveEndpoint(client, meta, ctx, rule.bParam, typeOfB);
          // Map traversal direction back onto the stored (a, b) columns.
          const [objA, objB] =
            from === "a" ? [endA.objId, endB.objId] : [endB.objId, endA.objId];

          if (rule.type === "create_link") {
            if (link.cardinality !== "many_to_many") {
              const clash = await client.query(
                `select 1 from link_instance where link_type_id = $1 and (obj_a = $2 ${link.cardinality === "one_to_one" ? "or obj_b = $3" : "and false"} or obj_b = $3) limit 1`,
                [link.id, objA, objB]
              );
              if (clash.rows.length)
                throw new ApiError(409, `Link ${link.displayName} violates ${link.cardinality} cardinality`);
            }
            const inserted = await client.query(
              `insert into link_instance (link_type_id, obj_a, obj_b, from_edit) values ($1, $2, $3, true)
               on conflict do nothing returning id`,
              [link.id, objA, objB]
            );
            if (inserted.rows.length) {
              await client.query(
                `insert into edit_log (action_instance_id, link_id, edit_type, patch) values ($1, $2, 'create_link', $3)`,
                [actionInstanceId, inserted.rows[0].id, JSON.stringify({ a: endA.pk, b: endB.pk })]
              );
            }
            edits.push({ editType: "create_link", link: rule.linkType, patch: { a: endA.pk, b: endB.pk } });
          } else {
            const deleted = await client.query(
              `delete from link_instance where link_type_id = $1 and obj_a = $2 and obj_b = $3 returning id`,
              [link.id, objA, objB]
            );
            if (deleted.rows.length) {
              await client.query(
                `insert into edit_log (action_instance_id, link_id, edit_type, patch) values ($1, $2, 'delete_link', $3)`,
                [actionInstanceId, deleted.rows[0].id, JSON.stringify({ a: endA.pk, b: endB.pk })]
              );
            }
            edits.push({ editType: "delete_link", link: rule.linkType, patch: { a: endA.pk, b: endB.pk } });
          }
          break;
        }
      }
    }

    await client.query(
      `insert into audit_log (actor, category, detail) values ($1, 'actionApplied', $2)`,
      [actor, JSON.stringify({ action: actionApiName, actionInstanceId, editCount: edits.length })]
    );
    await client.query("commit");
    return { valid: true, actionInstanceId, edits };
  } catch (err) {
    await client.query("rollback");
    if (err instanceof ApiError) {
      await pool.query(
        `insert into action_instance (action_type_id, actor, params, status, error) values ($1, $2, $3, 'failed', $4)`,
        [action.id, actor, JSON.stringify(params), err.message]
      );
    }
    throw err;
  } finally {
    client.release();
  }
}
