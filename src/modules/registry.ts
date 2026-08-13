// Widget registry metadata: what each widget is, and which config fields the
// builder should render for it. The React components live in
// app/modules/components/widgets.tsx; this file is import-safe on the server.

export type FieldKind =
  | "text" // free text
  | "number"
  | "objectType" // select an ontology object type
  | "property" // select a searchable property of the chosen object type
  | "columns" // multi-select of properties
  | "variable" // name of a module variable
  | "action" // select an action type
  | "link" // traversal api name available from the chosen object type
  | "filters"; // the FilterConfig[] editor

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
}

export interface WidgetDescriptor {
  key: string;
  label: string;
  description: string;
  fields: FieldDef[];
}

export const WIDGETS: WidgetDescriptor[] = [
  {
    key: "stat",
    label: "Stat tile",
    description: "A single aggregate count over a filtered object set.",
    fields: [
      { key: "objectType", label: "Object type", kind: "objectType", required: true },
      { key: "filters", label: "Filters", kind: "filters" },
      { key: "label", label: "Label", kind: "text" },
    ],
  },
  {
    key: "barChart",
    label: "Bar chart",
    description: "Counts grouped by a property, as horizontal bars.",
    fields: [
      { key: "objectType", label: "Object type", kind: "objectType", required: true },
      { key: "groupBy", label: "Group by", kind: "property", required: true },
      { key: "filters", label: "Filters", kind: "filters" },
      { key: "limit", label: "Max bars", kind: "number" },
    ],
  },
  {
    key: "objectTable",
    label: "Object table",
    description: "A filtered object set as a table; row click writes a selection variable.",
    fields: [
      { key: "objectType", label: "Object type", kind: "objectType", required: true },
      { key: "columns", label: "Columns", kind: "columns" },
      { key: "filters", label: "Filters", kind: "filters" },
      { key: "pageSize", label: "Rows", kind: "number" },
      { key: "selectionVar", label: "Selection variable", kind: "variable", help: "Set to the clicked row's primary key" },
    ],
  },
  {
    key: "facetFilter",
    label: "Facet filter",
    description: "Dropdown of a property's top values; writes a variable other widgets filter on.",
    fields: [
      { key: "objectType", label: "Object type", kind: "objectType", required: true },
      { key: "property", label: "Property", kind: "property", required: true },
      { key: "variable", label: "Writes variable", kind: "variable", required: true },
      { key: "label", label: "Label", kind: "text" },
    ],
  },
  {
    key: "textInput",
    label: "Text input",
    description: "Free-text input bound to a variable (pair with a contains filter).",
    fields: [
      { key: "variable", label: "Writes variable", kind: "variable", required: true },
      { key: "label", label: "Label", kind: "text" },
      { key: "placeholder", label: "Placeholder", kind: "text" },
    ],
  },
  {
    key: "objectCard",
    label: "Object card",
    description: "Properties of the object whose primary key is in a variable.",
    fields: [
      { key: "objectType", label: "Object type", kind: "objectType", required: true },
      { key: "pkVar", label: "Primary key variable", kind: "variable", required: true },
    ],
  },
  {
    key: "linkedList",
    label: "Linked objects",
    description: "Objects linked to the selected object via a chosen link.",
    fields: [
      { key: "objectType", label: "Object type", kind: "objectType", required: true },
      { key: "pkVar", label: "Primary key variable", kind: "variable", required: true },
      { key: "link", label: "Link", kind: "link", required: true },
    ],
  },
  {
    key: "markdown",
    label: "Text block",
    description: "Markdown text; {{variable}} interpolates current values.",
    fields: [{ key: "content", label: "Content", kind: "text", required: true }],
  },
  {
    key: "actionForm",
    label: "Action form",
    description: "Auto-generated form for an ontology action; the governed write path.",
    fields: [{ key: "action", label: "Action", kind: "action", required: true }],
  },
];

export const WIDGET_BY_KEY = new Map(WIDGETS.map((w) => [w.key, w]));
