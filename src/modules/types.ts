// The module model: a module is a JSON document — variables (the only state)
// plus an ordered list of widget instances. Widgets bind to variables through
// their config; data access always goes through the object-set endpoints.

export interface VariableDef {
  id: string;
  type: "string" | "number" | "objectRef" | "json";
  initial?: unknown;
}

/** A config-level filter. When `var` is set the value comes from a module
 *  variable at runtime; an empty/null variable value skips the filter. */
export interface FilterConfig {
  property: string;
  op: "eq" | "neq" | "contains" | "startsWith" | "gt" | "gte" | "lt" | "lte";
  value?: unknown;
  var?: string;
}

export interface WidgetInstance {
  id: string;
  widget: string; // registry key
  title?: string;
  width: "full" | "half" | "third";
  config: Record<string, unknown>;
}

export interface ModuleDef {
  variables: VariableDef[];
  widgets: WidgetInstance[];
}

export interface ModuleRecord {
  id: string;
  apiName: string;
  displayName: string;
  description: string | null;
  draft: ModuleDef;
  published: ModuleDef | null;
  publishedVersion: number;
  updatedAt: string;
}

export function emptyModule(): ModuleDef {
  return { variables: [], widgets: [] };
}

/** Structural sanity check for a module definition (not a full validator). */
export function validateModuleDef(def: unknown): string | null {
  if (typeof def !== "object" || def === null) return "definition must be an object";
  const d = def as Partial<ModuleDef>;
  if (!Array.isArray(d.variables)) return "variables must be an array";
  if (!Array.isArray(d.widgets)) return "widgets must be an array";
  const varIds = new Set<string>();
  for (const v of d.variables) {
    if (!v.id || typeof v.id !== "string") return "every variable needs a string id";
    if (varIds.has(v.id)) return `duplicate variable id: ${v.id}`;
    varIds.add(v.id);
  }
  const widgetIds = new Set<string>();
  for (const w of d.widgets) {
    if (!w.id || typeof w.id !== "string") return "every widget needs a string id";
    if (widgetIds.has(w.id)) return `duplicate widget id: ${w.id}`;
    widgetIds.add(w.id);
    if (!w.widget || typeof w.widget !== "string") return `widget ${w.id} needs a registry key`;
    if (!["full", "half", "third"].includes(w.width)) return `widget ${w.id} has invalid width`;
    if (typeof w.config !== "object" || w.config === null) return `widget ${w.id} needs a config object`;
  }
  return null;
}
