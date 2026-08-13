"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { OntologyMeta } from "@/ontology/types";
import { FilterConfig, ModuleDef, ModuleRecord, VariableDef, WidgetInstance } from "@/modules/types";
import { WIDGETS, WIDGET_BY_KEY, FieldDef } from "@/modules/registry";
import { ModuleRuntime } from "../../components/ModuleRuntime";

let nextId = 1;
const freshId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${nextId++}`;

/** Every variable name referenced anywhere in widget configs. */
function referencedVariables(def: ModuleDef): Map<string, VariableDef["type"]> {
  const out = new Map<string, VariableDef["type"]>();
  for (const w of def.widgets) {
    for (const key of ["variable", "selectionVar", "pkVar"] as const) {
      const v = w.config[key];
      if (typeof v === "string" && v) out.set(v, key === "variable" ? "string" : "objectRef");
    }
    const filters = (w.config.filters as FilterConfig[]) ?? [];
    for (const f of filters) if (f.var) out.set(f.var, out.get(f.var) ?? "string");
  }
  return out;
}

/** Draft to persist: declared variables plus any referenced-but-undeclared ones. */
function withAutoVariables(def: ModuleDef): ModuleDef {
  const declared = new Set(def.variables.map((v) => v.id));
  const auto: VariableDef[] = [];
  for (const [id, type] of referencedVariables(def)) {
    if (!declared.has(id)) auto.push({ id, type, initial: null });
  }
  return { ...def, variables: [...def.variables, ...auto] };
}

export function ModuleBuilder({ module, meta }: { module: ModuleRecord; meta: OntologyMeta }) {
  const [def, setDef] = useState<ModuleDef>(module.draft);
  const [selectedId, setSelectedId] = useState<string | null>(def.widgets[0]?.id ?? null);
  const [status, setStatus] = useState<string>("");
  const [preview, setPreview] = useState(true);
  const [previewNonce, setPreviewNonce] = useState(0);

  const selected = def.widgets.find((w) => w.id === selectedId) ?? null;

  function mutate(fn: (d: ModuleDef) => ModuleDef) {
    setDef((d) => fn(structuredClone(d)));
    setStatus("unsaved changes");
  }

  function addWidget(key: string) {
    const id = freshId(key);
    mutate((d) => ({
      ...d,
      widgets: [...d.widgets, { id, widget: key, width: "half", config: {} }],
    }));
    setSelectedId(id);
  }

  function updateSelected(patch: Partial<WidgetInstance>) {
    if (!selectedId) return;
    mutate((d) => ({
      ...d,
      widgets: d.widgets.map((w) => (w.id === selectedId ? { ...w, ...patch } : w)),
    }));
  }

  function updateConfig(key: string, value: unknown) {
    if (!selected) return;
    updateSelected({ config: { ...selected.config, [key]: value } });
  }

  function move(id: string, dir: -1 | 1) {
    mutate((d) => {
      const i = d.widgets.findIndex((w) => w.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.widgets.length) return d;
      const widgets = [...d.widgets];
      [widgets[i], widgets[j]] = [widgets[j], widgets[i]];
      return { ...d, widgets };
    });
  }

  function remove(id: string) {
    mutate((d) => ({ ...d, widgets: d.widgets.filter((w) => w.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }

  async function save(): Promise<boolean> {
    const draft = withAutoVariables(def);
    const res = await fetch(`/api/modules/${module.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft }),
    });
    const d = await res.json();
    if (d.error) {
      setStatus(`save failed: ${d.error}`);
      return false;
    }
    setDef(draft);
    setStatus("draft saved");
    setPreviewNonce((n) => n + 1);
    return true;
  }

  async function publish() {
    if (!(await save())) return;
    const res = await fetch(`/api/modules/${module.id}/publish`, { method: "POST" });
    const d = await res.json();
    setStatus(d.error ? `publish failed: ${d.error}` : `published v${d.version}`);
  }

  return (
    <main>
      <p className="mono">
        <Link href="/modules">Modules</Link>
      </p>
      <h1>{module.displayName}</h1>
      <p className="sub">
        Builder — compose widgets over the ontology. Variables wire widgets together; referenced
        variables are declared automatically on save.
      </p>

      <div className="builder-toolbar">
        <button className="runbtn" onClick={save}>Save draft</button>
        <button className="runbtn" onClick={publish}>Publish</button>
        <button className="runbtn" onClick={() => setPreview((v) => !v)}>
          {preview ? "Hide preview" : "Show preview"}
        </button>
        <Link className="runbtn" href={`/modules/${module.id}`}>Open viewer</Link>
        <span className="section-note" style={{ margin: 0 }}>
          {status || `v${module.publishedVersion} published`}
        </span>
      </div>

      <div className="builder-grid">
        <div>
          <h2 style={{ marginTop: 0 }}>Widgets</h2>
          {def.widgets.map((w) => (
            <div
              key={w.id}
              className={`builder-item ${w.id === selectedId ? "sel" : ""}`}
              onClick={() => setSelectedId(w.id)}
            >
              <span className="mono dim">{WIDGET_BY_KEY.get(w.widget)?.label ?? w.widget}</span>
              <span className="builder-item-title">{w.title || w.id}</span>
              <span className="builder-item-actions">
                <button onClick={(e) => (e.stopPropagation(), move(w.id, -1))} aria-label="Move up">↑</button>
                <button onClick={(e) => (e.stopPropagation(), move(w.id, 1))} aria-label="Move down">↓</button>
                <button onClick={(e) => (e.stopPropagation(), remove(w.id))} aria-label="Remove">×</button>
              </span>
            </div>
          ))}
          <select
            className="field"
            value=""
            onChange={(e) => e.target.value && addWidget(e.target.value)}
            aria-label="Add widget"
          >
            <option value="">+ Add widget…</option>
            {WIDGETS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label} — {w.description}
              </option>
            ))}
          </select>

          <h2>Variables</h2>
          <p className="section-note">
            {[...referencedVariables(def).keys()].join(", ") || "none referenced yet"}
          </p>
        </div>

        <div>
          <h2 style={{ marginTop: 0 }}>Configuration</h2>
          {selected ? (
            <WidgetConfigForm
              key={selected.id}
              widget={selected}
              meta={meta}
              knownVars={[...referencedVariables(def).keys()]}
              onTitle={(t) => updateSelected({ title: t })}
              onWidth={(w) => updateSelected({ width: w })}
              onConfig={updateConfig}
            />
          ) : (
            <p className="empty">Select a widget to configure it.</p>
          )}
        </div>
      </div>

      {preview && (
        <>
          <h2>Preview (draft)</h2>
          <ModuleRuntime key={previewNonce} def={withAutoVariables(def)} meta={meta} />
        </>
      )}
    </main>
  );
}

function WidgetConfigForm({
  widget,
  meta,
  knownVars,
  onTitle,
  onWidth,
  onConfig,
}: {
  widget: WidgetInstance;
  meta: OntologyMeta;
  knownVars: string[];
  onTitle: (t: string) => void;
  onWidth: (w: WidgetInstance["width"]) => void;
  onConfig: (key: string, value: unknown) => void;
}) {
  const descriptor = WIDGET_BY_KEY.get(widget.widget);
  const objectType = widget.config.objectType as string | undefined;
  const typeMeta = meta.types.find((t) => t.apiName === objectType);
  const searchable = useMemo(
    () => typeMeta?.properties.filter((p) => p.searchable) ?? [],
    [typeMeta]
  );
  const outboundLinks = useMemo(() => {
    if (!objectType) return [];
    return meta.links.flatMap((l) => {
      const out: { name: string; label: string }[] = [];
      if (l.objectTypeA === objectType) out.push({ name: l.apiNameAToB, label: `${l.displayName} → ${l.objectTypeB}` });
      if (l.objectTypeB === objectType) out.push({ name: l.apiNameBToA, label: `${l.displayName} → ${l.objectTypeA}` });
      return out;
    });
  }, [meta, objectType]);

  if (!descriptor) return <p className="widget-err">Unknown widget type.</p>;

  function renderField(f: FieldDef) {
    const value = widget.config[f.key];
    switch (f.kind) {
      case "text":
        return f.key === "content" ? (
          <textarea className="field" rows={6} value={(value as string) ?? ""} onChange={(e) => onConfig(f.key, e.target.value)} />
        ) : (
          <input className="field" value={(value as string) ?? ""} onChange={(e) => onConfig(f.key, e.target.value)} />
        );
      case "number":
        return (
          <input
            className="field"
            type="number"
            value={value == null ? "" : String(value)}
            onChange={(e) => onConfig(f.key, e.target.value === "" ? undefined : Number(e.target.value))}
          />
        );
      case "objectType":
        return (
          <select className="field" value={(value as string) ?? ""} onChange={(e) => onConfig(f.key, e.target.value)}>
            <option value="">—</option>
            {meta.types.map((t) => (
              <option key={t.apiName} value={t.apiName}>{t.displayName}</option>
            ))}
          </select>
        );
      case "property":
        return (
          <select className="field" value={(value as string) ?? ""} onChange={(e) => onConfig(f.key, e.target.value)}>
            <option value="">—</option>
            {searchable.map((p) => (
              <option key={p.apiName} value={p.apiName}>{p.displayName}</option>
            ))}
          </select>
        );
      case "columns": {
        const cols = (value as string[]) ?? [];
        return (
          <div className="col-picks">
            {searchable.map((p) => (
              <label key={p.apiName}>
                <input
                  type="checkbox"
                  checked={cols.includes(p.apiName)}
                  onChange={(e) =>
                    onConfig(f.key, e.target.checked ? [...cols, p.apiName] : cols.filter((c) => c !== p.apiName))
                  }
                />{" "}
                {p.displayName}
              </label>
            ))}
          </div>
        );
      }
      case "variable":
        return (
          <>
            <input
              className="field"
              list={`vars-${widget.id}-${f.key}`}
              value={(value as string) ?? ""}
              onChange={(e) => onConfig(f.key, e.target.value)}
              placeholder="variableName"
            />
            <datalist id={`vars-${widget.id}-${f.key}`}>
              {knownVars.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </>
        );
      case "action":
        return (
          <select className="field" value={(value as string) ?? ""} onChange={(e) => onConfig(f.key, e.target.value)}>
            <option value="">—</option>
            {meta.actions.map((a) => (
              <option key={a.apiName} value={a.apiName}>{a.displayName}</option>
            ))}
          </select>
        );
      case "link":
        return (
          <select className="field" value={(value as string) ?? ""} onChange={(e) => onConfig(f.key, e.target.value)}>
            <option value="">—</option>
            {outboundLinks.map((l) => (
              <option key={l.name} value={l.name}>{l.label}</option>
            ))}
          </select>
        );
      case "filters":
        return (
          <FiltersEditor
            filters={(value as FilterConfig[]) ?? []}
            properties={searchable.map((p) => p.apiName)}
            knownVars={knownVars}
            onChange={(fs) => onConfig(f.key, fs)}
          />
        );
    }
  }

  return (
    <div>
      <label className="field-label">Widget title</label>
      <input className="field" value={widget.title ?? ""} onChange={(e) => onTitle(e.target.value)} />
      <label className="field-label">Width</label>
      <select className="field" value={widget.width} onChange={(e) => onWidth(e.target.value as WidgetInstance["width"])}>
        <option value="full">Full</option>
        <option value="half">Half</option>
        <option value="third">Third</option>
      </select>
      {descriptor.fields.map((f) => (
        <div key={f.key} style={{ marginBottom: "0.6rem" }}>
          <label className="field-label">
            {f.label}
            {f.required ? " *" : ""}
          </label>
          {renderField(f)}
          {f.help && <p className="section-note" style={{ margin: "0.15rem 0 0" }}>{f.help}</p>}
        </div>
      ))}
    </div>
  );
}

function FiltersEditor({
  filters,
  properties,
  knownVars,
  onChange,
}: {
  filters: FilterConfig[];
  properties: string[];
  knownVars: string[];
  onChange: (f: FilterConfig[]) => void;
}) {
  function update(i: number, patch: Partial<FilterConfig>) {
    onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }
  return (
    <div>
      {filters.map((f, i) => (
        <div className="filter-row" key={i}>
          <select className="field" value={f.property} onChange={(e) => update(i, { property: e.target.value })}>
            <option value="">property…</option>
            {properties.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className="field" value={f.op} onChange={(e) => update(i, { op: e.target.value as FilterConfig["op"] })}>
            {["eq", "neq", "contains", "startsWith", "gt", "gte", "lt", "lte"].map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
          <input
            className="field"
            placeholder="static value"
            value={(f.value as string) ?? ""}
            onChange={(e) => update(i, { value: e.target.value || undefined })}
            disabled={!!f.var}
          />
          <input
            className="field"
            placeholder="or $variable"
            list={`filter-vars-${i}`}
            value={f.var ?? ""}
            onChange={(e) => update(i, { var: e.target.value || undefined })}
          />
          <datalist id={`filter-vars-${i}`}>
            {knownVars.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <button className="runbtn" onClick={() => onChange(filters.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="runbtn" onClick={() => onChange([...filters, { property: "", op: "eq" }])}>
        + Filter
      </button>
    </div>
  );
}
