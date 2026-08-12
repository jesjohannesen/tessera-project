// Shared types for the ontology spine: metadata shapes, the object-set AST,
// and declarative action definitions.

export type PropertyType =
  | "string"
  | "integer"
  | "double"
  | "boolean"
  | "date"
  | "timestamp"
  | "geopoint"
  | "string_array"
  | "json";

export interface PropertyDef {
  apiName: string;
  displayName: string;
  description?: string;
  type: PropertyType;
  searchable: boolean;
  required: boolean;
  position: number;
}

export interface ObjectTypeMeta {
  id: string;
  apiName: string;
  displayName: string;
  description?: string;
  kind: "entity" | "event" | "document";
  pkProperty: string;
  titleProperty: string;
  status: string;
  properties: PropertyDef[];
}

export interface LinkTypeMeta {
  id: string;
  apiNameAToB: string;
  apiNameBToA: string;
  displayName: string;
  objectTypeA: string; // object type api name
  objectTypeB: string;
  cardinality: "one_to_one" | "one_to_many" | "many_to_many";
}

export interface ActionParameter {
  apiName: string;
  displayName?: string;
  description?: string;
  type: PropertyType | "object_ref";
  objectType?: string; // required when type is object_ref
  required?: boolean;
}

export interface SubmissionCriterion {
  param: string;
  op: "nonEmpty" | "regex" | "oneOf" | "maxLength";
  value?: unknown;
  message: string;
}

export type PropSource =
  | { kind: "parameter"; param: string }
  | { kind: "static"; value: unknown }
  | { kind: "context"; value: "currentUser" | "now" };

export type ActionRule =
  | {
      type: "create_object";
      objectType: string;
      pkFrom: PropSource;
      properties: Record<string, PropSource>;
    }
  | {
      type: "modify_object";
      objectType: string;
      targetParam: string;
      properties: Record<string, PropSource>;
    }
  | { type: "delete_object"; objectType: string; targetParam: string }
  | { type: "create_link"; linkType: string; aParam: string; bParam: string }
  | { type: "delete_link"; linkType: string; aParam: string; bParam: string };

export interface ActionTypeMeta {
  id: string;
  apiName: string;
  displayName: string;
  description?: string;
  parameters: ActionParameter[];
  submissionCriteria: SubmissionCriterion[];
  rules: ActionRule[];
  status: string;
}

export interface OntologyMeta {
  types: ObjectTypeMeta[];
  links: LinkTypeMeta[];
  actions: ActionTypeMeta[];
}

// ---- Object-set AST ----

export type Filter =
  | { op: "and" | "or"; clauses: Filter[] }
  | { op: "not"; clause: Filter }
  | {
      op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
      property: string;
      value: unknown;
    }
  | { op: "contains" | "startsWith"; property: string; value: string }
  | { op: "isNull"; property: string };

export interface Pivot {
  link: string; // link api name, direction implied by which side's name is used
  filter?: Filter;
}

export interface ObjectSetAST {
  type: string; // base object type api name
  filter?: Filter;
  pivots?: Pivot[];
}

export interface OrderBy {
  property: string;
  direction?: "asc" | "desc";
}

export interface Aggregation {
  groupBy?: { property: string };
  metrics: {
    fn: "count" | "sum" | "avg" | "min" | "max" | "cardinality";
    property?: string;
    as?: string;
  }[];
}

export interface LoadedObject {
  type: string;
  pk: string;
  title: string | null;
  props: Record<string, unknown>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
