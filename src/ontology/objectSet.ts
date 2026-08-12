// The object-set evaluator: compiles a JSON AST (filter + link pivots) into a
// single parameterized SQL query. This is the one query path shared by every
// surface — API routes, UI pages, and (later) AI tools.

import { getPool } from "@/db/client";
import { getOntology, requireType, resolveLink } from "./metadata";
import {
  Aggregation,
  ApiError,
  Filter,
  LoadedObject,
  ObjectSetAST,
  ObjectTypeMeta,
  OntologyMeta,
  OrderBy,
  PropertyDef,
} from "./types";

const MAX_PAGE_SIZE = 200;
const MAX_PIVOTS = 3;

class QB {
  params: unknown[] = [];
  add(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
}

function requireSearchable(type: ObjectTypeMeta, property: string): PropertyDef {
  const def = type.properties.find((p) => p.apiName === property);
  if (!def) throw new ApiError(400, `Unknown property ${type.apiName}.${property}`);
  // Primary keys are always addressable; everything else must opt in.
  if (!def.searchable && def.apiName !== type.pkProperty)
    throw new ApiError(400, `Property ${type.apiName}.${property} is not searchable`);
  return def;
}

function propExpr(alias: string, def: PropertyDef): string {
  const raw = `${alias}.props->>'${def.apiName.replace(/'/g, "")}'`;
  if (def.type === "integer" || def.type === "double") return `(${raw})::numeric`;
  if (def.type === "boolean") return `(${raw})::boolean`;
  return raw;
}

function compileFilter(
  filter: Filter,
  alias: string,
  type: ObjectTypeMeta,
  qb: QB
): string {
  switch (filter.op) {
    case "and":
    case "or": {
      if (!filter.clauses.length) return "true";
      const parts = filter.clauses.map((c) => compileFilter(c, alias, type, qb));
      return `(${parts.join(` ${filter.op} `)})`;
    }
    case "not":
      return `(not ${compileFilter(filter.clause, alias, type, qb)})`;
    case "isNull": {
      const def = requireSearchable(type, filter.property);
      return `(${alias}.props->>'${def.apiName}') is null`;
    }
    case "eq":
    case "neq": {
      const def = requireSearchable(type, filter.property);
      const cmp = filter.op === "eq" ? "=" : "is distinct from";
      return `${propExpr(alias, def)} ${cmp} ${qb.add(filter.value)}`;
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const def = requireSearchable(type, filter.property);
      const ops = { lt: "<", lte: "<=", gt: ">", gte: ">=" } as const;
      return `${propExpr(alias, def)} ${ops[filter.op]} ${qb.add(filter.value)}`;
    }
    case "contains": {
      const def = requireSearchable(type, filter.property);
      if (def.type === "string_array") {
        return `${alias}.props->'${def.apiName}' ? ${qb.add(filter.value)}`;
      }
      return `${alias}.props->>'${def.apiName}' ilike '%' || ${qb.add(filter.value)} || '%'`;
    }
    case "startsWith": {
      const def = requireSearchable(type, filter.property);
      return `${alias}.props->>'${def.apiName}' ilike ${qb.add(filter.value)} || '%'`;
    }
    default:
      throw new ApiError(400, `Unknown filter op`);
  }
}

interface CompiledSet {
  /** CTE definitions, in order. The final CTE holds the result object ids. */
  ctes: string[];
  finalCte: string;
  finalType: ObjectTypeMeta;
  qb: QB;
}

function compileObjectSet(meta: OntologyMeta, ast: ObjectSetAST): CompiledSet {
  const qb = new QB();
  const baseType = requireType(meta, ast.type);
  const ctes: string[] = [];

  let filterSql = ast.filter ? compileFilter(ast.filter, "o", baseType, qb) : null;
  ctes.push(
    `s0 as (select o.id from obj o where o.object_type_id = ${qb.add(baseType.id)} and not o.deleted${filterSql ? ` and ${filterSql}` : ""})`
  );

  let currentType = baseType;
  const pivots = ast.pivots ?? [];
  if (pivots.length > MAX_PIVOTS)
    throw new ApiError(400, `At most ${MAX_PIVOTS} pivots per object set`);

  pivots.forEach((pivot, i) => {
    const { link, from } = resolveLink(meta, pivot.link);
    const expectedSource = from === "a" ? link.objectTypeA : link.objectTypeB;
    if (expectedSource !== currentType.apiName) {
      throw new ApiError(
        400,
        `Link ${pivot.link} traverses from ${expectedSource}, but the current set is ${currentType.apiName}`
      );
    }
    const nextTypeName = from === "a" ? link.objectTypeB : link.objectTypeA;
    const nextType = requireType(meta, nextTypeName);
    const [near, far] = from === "a" ? ["obj_a", "obj_b"] : ["obj_b", "obj_a"];
    const pivotFilter = pivot.filter
      ? ` and ${compileFilter(pivot.filter, "o", nextType, qb)}`
      : "";
    ctes.push(
      `s${i + 1} as (select distinct o.id from obj o join link_instance li on li.link_type_id = ${qb.add(link.id)} and li.${far} = o.id and li.${near} in (select id from s${i}) where not o.deleted${pivotFilter})`
    );
    currentType = nextType;
  });

  return { ctes, finalCte: `s${pivots.length}`, finalType: currentType, qb };
}

export interface LoadOptions {
  pageSize?: number;
  offset?: number;
  orderBy?: OrderBy;
}

export async function loadObjectSet(
  ast: ObjectSetAST,
  opts: LoadOptions = {}
): Promise<{ objects: LoadedObject[]; totalCount: number; type: string }> {
  const meta = await getOntology();
  const { ctes, finalCte, finalType, qb } = compileObjectSet(meta, ast);

  let orderSql: string;
  if (opts.orderBy) {
    const def = requireSearchable(finalType, opts.orderBy.property);
    const dir = opts.orderBy.direction === "desc" ? "desc" : "asc";
    orderSql = `${propExpr("o", def)} ${dir} nulls last`;
  } else {
    orderSql = `o.props->>'${finalType.titleProperty}' asc nulls last`;
  }

  const pageSize = Math.min(opts.pageSize ?? 50, MAX_PAGE_SIZE);
  const offset = Math.max(opts.offset ?? 0, 0);

  const sql = `with ${ctes.join(",\n")}
select o.pk_value, o.props, count(*) over () as total
from obj o
where o.id in (select id from ${finalCte})
order by ${orderSql}
limit ${qb.add(pageSize)} offset ${qb.add(offset)}`;

  const res = await getPool().query(sql, qb.params);
  return {
    type: finalType.apiName,
    totalCount: res.rows.length ? Number(res.rows[0].total) : 0,
    objects: res.rows.map((r) => ({
      type: finalType.apiName,
      pk: r.pk_value,
      title: (r.props?.[finalType.titleProperty] as string) ?? null,
      props: r.props,
    })),
  };
}

export async function aggregateObjectSet(
  ast: ObjectSetAST,
  agg: Aggregation
): Promise<{ groups: Record<string, unknown>[] }> {
  const meta = await getOntology();
  const { ctes, finalCte, finalType, qb } = compileObjectSet(meta, ast);

  if (!agg.metrics?.length) throw new ApiError(400, "At least one metric required");

  const selects: string[] = [];
  const groupBys: string[] = [];
  if (agg.groupBy) {
    const def = requireSearchable(finalType, agg.groupBy.property);
    selects.push(`o.props->>'${def.apiName}' as group_key`);
    groupBys.push(`o.props->>'${def.apiName}'`);
  }
  agg.metrics.forEach((m, i) => {
    const name = m.as ?? `${m.fn}${m.property ? `_${m.property}` : ""}`;
    const safe = name.replace(/[^a-zA-Z0-9_]/g, "_");
    if (m.fn === "count") {
      selects.push(`count(*)::int as "${safe}"`);
      return;
    }
    if (!m.property) throw new ApiError(400, `Metric ${m.fn} requires a property`);
    const def = requireSearchable(finalType, m.property);
    if (m.fn === "cardinality") {
      selects.push(`count(distinct o.props->>'${def.apiName}')::int as "${safe}"`);
      return;
    }
    if (def.type !== "integer" && def.type !== "double") {
      throw new ApiError(400, `Metric ${m.fn} requires a numeric property`);
    }
    selects.push(`${m.fn}((o.props->>'${def.apiName}')::numeric) as "${safe}"`);
  });

  const sql = `with ${ctes.join(",\n")}
select ${selects.join(", ")}
from obj o
where o.id in (select id from ${finalCte})
${groupBys.length ? `group by ${groupBys.join(", ")} order by 2 desc` : ""}`;

  const res = await getPool().query(sql, qb.params);
  return { groups: res.rows };
}

export async function getObject(typeApiName: string, pk: string) {
  const meta = await getOntology();
  const type = requireType(meta, typeApiName);
  const res = await getPool().query(
    `select * from obj where object_type_id = $1 and pk_value = $2 and not deleted`,
    [type.id, pk]
  );
  if (!res.rows.length) throw new ApiError(404, `${typeApiName} ${pk} not found`);
  const r = res.rows[0];
  return {
    type: type.apiName,
    pk: r.pk_value,
    title: (r.props?.[type.titleProperty] as string) ?? null,
    props: r.props,
    sourceProps: r.source_props,
    editProps: r.edit_props,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listLinked(
  typeApiName: string,
  pk: string,
  linkApiName: string
): Promise<{ objects: LoadedObject[]; type: string }> {
  const meta = await getOntology();
  const type = requireType(meta, typeApiName);
  const result = await loadObjectSet(
    {
      type: typeApiName,
      filter: { op: "eq", property: type.pkProperty, value: pk },
      pivots: [{ link: linkApiName }],
    },
    { pageSize: MAX_PAGE_SIZE }
  );
  return { objects: result.objects, type: result.type };
}
