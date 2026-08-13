// Compiles config-level filters + current variable values into the object-set
// Filter AST. Pure function shared by the runtime (request payloads) and
// tests. A filter bound to an empty variable is skipped — that is what makes
// facet dropdowns and text inputs compose without an expression engine.

import { Filter } from "@/ontology/types";
import { FilterConfig } from "./types";

export function resolveFilters(
  filters: FilterConfig[] | undefined,
  vars: Record<string, unknown>
): Filter | undefined {
  if (!filters?.length) return undefined;
  const clauses: Filter[] = [];
  for (const f of filters) {
    let value = f.var !== undefined ? vars[f.var] : f.value;
    if (value === undefined || value === null || value === "") continue;
    if (["gt", "gte", "lt", "lte"].includes(f.op)) {
      const n = Number(value);
      if (!Number.isNaN(n)) value = n;
    }
    clauses.push({ op: f.op, property: f.property, value } as Filter);
  }
  if (!clauses.length) return undefined;
  return clauses.length === 1 ? clauses[0] : { op: "and", clauses };
}

/** Variable ids a widget's filter config depends on. */
export function filterVarDeps(filters: FilterConfig[] | undefined): string[] {
  return [...new Set((filters ?? []).flatMap((f) => (f.var ? [f.var] : [])))];
}
