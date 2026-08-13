"use client";

// The module runtime: variables are the only state; widgets read them and
// write back through setVar; data flows through the object-set endpoints.

import { useState } from "react";
import { OntologyMeta } from "@/ontology/types";
import { ModuleDef, WidgetInstance } from "@/modules/types";
import { Markdown } from "@/app/components/Markdown";
import {
  ActionFormWidget,
  BarChartWidget,
  FacetFilterWidget,
  LinkedListWidget,
  ObjectCardWidget,
  ObjectTableWidget,
  StatWidget,
  TextInputWidget,
  WidgetProps,
} from "./widgets";

const COMPONENTS: Record<string, (p: WidgetProps) => React.ReactElement> = {
  stat: StatWidget,
  barChart: BarChartWidget,
  objectTable: ObjectTableWidget,
  facetFilter: FacetFilterWidget,
  textInput: TextInputWidget,
  objectCard: ObjectCardWidget,
  linkedList: LinkedListWidget,
  actionForm: ActionFormWidget,
};

function MarkdownWidget({ instance, vars }: WidgetProps) {
  const content = String(instance.config.content ?? "");
  const interpolated = content.replace(/\{\{(\w+)\}\}/g, (_, id) => {
    const v = vars[id];
    return v == null ? "—" : String(v);
  });
  return <Markdown text={interpolated} />;
}
COMPONENTS.markdown = MarkdownWidget;

export function ModuleRuntime({ def, meta }: { def: ModuleDef; meta: OntologyMeta }) {
  const [vars, setVars] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(def.variables.map((v) => [v.id, v.initial ?? null]))
  );
  const setVar = (id: string, value: unknown) => setVars((s) => ({ ...s, [id]: value }));

  return (
    <div className="module-grid">
      {def.widgets.map((w: WidgetInstance) => {
        const Comp = COMPONENTS[w.widget];
        return (
          <section key={w.id} className={`widget w-${w.width}`}>
            {w.title && <header className="widget-title">{w.title}</header>}
            <div className="widget-body">
              {Comp ? (
                <Comp instance={w} vars={vars} setVar={setVar} meta={meta} />
              ) : (
                <p className="widget-err">Unknown widget: {w.widget}</p>
              )}
            </div>
          </section>
        );
      })}
      {!def.widgets.length && <p className="empty">This module has no widgets yet.</p>}
    </div>
  );
}
