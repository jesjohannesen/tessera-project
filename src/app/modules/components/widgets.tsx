"use client";

// The widget components. Each binds to module variables through its config,
// fetches through the shared object-set endpoints, and mutates only through
// declared actions — the same contracts as every other surface.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { OntologyMeta } from "@/ontology/types";
import { FilterConfig, WidgetInstance } from "@/modules/types";
import { resolveFilters, filterVarDeps } from "@/modules/filters";

export interface WidgetProps {
  instance: WidgetInstance;
  vars: Record<string, unknown>;
  setVar: (id: string, value: unknown) => void;
  meta: OntologyMeta;
}

type Loaded = { pk: string; title: string | null; props: Record<string, unknown> };

/** Stable dependency key: config + only the variable values this widget reads. */
function useDepKey(instance: WidgetInstance, vars: Record<string, unknown>, extraVarKeys: string[] = []) {
  return useMemo(() => {
    const filters = (instance.config.filters as FilterConfig[] | undefined) ?? [];
    const keys = [...filterVarDeps(filters), ...extraVarKeys];
    const slice = Object.fromEntries(keys.map((k) => [k, vars[k]]));
    return JSON.stringify([instance.config, slice]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.config, JSON.stringify(vars), extraVarKeys.join(",")]);
}

function useObjectSetLoad(instance: WidgetInstance, vars: Record<string, unknown>) {
  const [data, setData] = useState<{ objects: Loaded[]; totalCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const depKey = useDepKey(instance, vars);
  useEffect(() => {
    const type = instance.config.objectType as string;
    if (!type) return;
    const filter = resolveFilters(instance.config.filters as FilterConfig[], vars);
    fetch("/api/object-sets/load", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        objectSet: { type, filter },
        pageSize: Number(instance.config.pageSize ?? 12),
      }),
    })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : (setError(null), setData(d))))
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);
  return { data, error };
}

function useAggregate(
  instance: WidgetInstance,
  vars: Record<string, unknown>,
  groupBy: string | undefined
) {
  const [groups, setGroups] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const depKey = useDepKey(instance, vars);
  useEffect(() => {
    const type = instance.config.objectType as string;
    if (!type) return;
    const filter = resolveFilters(instance.config.filters as FilterConfig[], vars);
    fetch("/api/object-sets/aggregate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        objectSet: { type, filter },
        aggregation: { groupBy: groupBy ? { property: groupBy } : undefined, metrics: [{ fn: "count", as: "n" }] },
      }),
    })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : (setError(null), setGroups(d.groups))))
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, groupBy]);
  return { groups, error };
}

function Err({ error }: { error: string | null }) {
  return error ? <p className="widget-err">{error}</p> : null;
}

// ---- Widgets ----

export function StatWidget(p: WidgetProps) {
  const { groups, error } = useAggregate(p.instance, p.vars, undefined);
  const n = groups?.[0]?.n ?? "—";
  return (
    <div>
      <div className="stat-n">{String(n)}</div>
      <div className="section-note" style={{ margin: 0 }}>
        {(p.instance.config.label as string) ?? "objects"}
      </div>
      <Err error={error} />
    </div>
  );
}

export function BarChartWidget(p: WidgetProps) {
  const groupBy = p.instance.config.groupBy as string;
  const { groups, error } = useAggregate(p.instance, p.vars, groupBy);
  const limit = Number(p.instance.config.limit ?? 8);
  const shown = (groups ?? []).filter((g) => g.group_key != null).slice(0, limit);
  const max = Math.max(1, ...shown.map((g) => Number(g.n)));
  return (
    <div>
      {shown.map((g) => (
        <div className="hbar-row" key={String(g.group_key)}>
          <span className="hbar-label">{String(g.group_key)}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(Number(g.n) / max) * 100}%` }} />
          </span>
          <span className="hbar-n">{String(g.n)}</span>
        </div>
      ))}
      {!shown.length && !error && <p className="empty">No data.</p>}
      <Err error={error} />
    </div>
  );
}

export function ObjectTableWidget(p: WidgetProps) {
  const { data, error } = useObjectSetLoad(p.instance, p.vars);
  const type = p.meta.types.find((t) => t.apiName === p.instance.config.objectType);
  const configured = p.instance.config.columns as string[] | undefined;
  const columns = (configured?.length
    ? configured
    : type?.properties.filter((pr) => pr.searchable && pr.apiName !== type.pkProperty).slice(0, 4).map((pr) => pr.apiName)
  ) ?? [];
  const selectionVar = p.instance.config.selectionVar as string | undefined;
  const selected = selectionVar ? p.vars[selectionVar] : undefined;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>{type?.titleProperty ?? "title"}</th>
            {columns.map((c) => (
              <th key={c}>{type?.properties.find((pr) => pr.apiName === c)?.displayName ?? c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data?.objects ?? []).map((o) => (
            <tr
              key={o.pk}
              onClick={() => selectionVar && p.setVar(selectionVar, o.pk)}
              style={{
                cursor: selectionVar ? "pointer" : undefined,
                background: selected === o.pk ? "var(--code-bg)" : undefined,
              }}
            >
              <td>{o.title ?? o.pk}</td>
              {columns.map((c) => {
                const v = o.props[c];
                return <td key={c}>{v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {data && (
        <p className="section-note" style={{ padding: "0.3rem 0.85rem" }}>
          {data.totalCount} total
        </p>
      )}
      <Err error={error} />
    </div>
  );
}

export function FacetFilterWidget(p: WidgetProps) {
  const property = p.instance.config.property as string;
  const variable = p.instance.config.variable as string;
  // Facet options ignore this widget's own variable so the list stays stable.
  const optionsInstance = useMemo(
    () => ({ ...p.instance, config: { ...p.instance.config, filters: [] } }),
    [p.instance]
  );
  const { groups, error } = useAggregate(optionsInstance, p.vars, property);
  const value = (p.vars[variable] as string) ?? "";
  return (
    <div>
      <label className="field-label">{(p.instance.config.label as string) ?? property}</label>
      <select className="field" value={value} onChange={(e) => p.setVar(variable, e.target.value || null)}>
        <option value="">All</option>
        {(groups ?? [])
          .filter((g) => g.group_key != null)
          .slice(0, 15)
          .map((g) => (
            <option key={String(g.group_key)} value={String(g.group_key)}>
              {String(g.group_key)} ({String(g.n)})
            </option>
          ))}
      </select>
      <Err error={error} />
    </div>
  );
}

export function TextInputWidget(p: WidgetProps) {
  const variable = p.instance.config.variable as string;
  const [local, setLocal] = useState((p.vars[variable] as string) ?? "");
  useEffect(() => {
    const t = setTimeout(() => p.setVar(variable, local || null), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return (
    <div>
      <label className="field-label">{(p.instance.config.label as string) ?? variable}</label>
      <input
        className="field"
        placeholder={(p.instance.config.placeholder as string) ?? ""}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
      />
    </div>
  );
}

export function ObjectCardWidget(p: WidgetProps) {
  const type = p.instance.config.objectType as string;
  const pk = p.vars[p.instance.config.pkVar as string] as string | undefined;
  const [obj, setObj] = useState<{ title: string | null; props: Record<string, unknown> } | null>(null);
  useEffect(() => {
    if (!pk) {
      setObj(null);
      return;
    }
    fetch(`/api/objects/${type}/${encodeURIComponent(pk)}`)
      .then((r) => r.json())
      .then((d) => setObj(d.error ? null : d));
  }, [type, pk]);
  if (!pk) return <p className="empty">Select an object.</p>;
  if (!obj) return <p className="empty">Loading…</p>;
  const typeMeta = p.meta.types.find((t) => t.apiName === type);
  return (
    <div>
      <p style={{ fontWeight: 700, margin: "0 0 0.5rem" }}>
        <Link className="rowlink" href={`/object/${type}/${encodeURIComponent(pk)}`}>
          {obj.title ?? pk}
        </Link>
      </p>
      <table>
        <tbody>
          {typeMeta?.properties.map((pr) => {
            const v = obj.props[pr.apiName];
            if (v == null) return null;
            return (
              <tr key={pr.apiName}>
                <td style={{ color: "var(--muted)", width: "7rem" }}>{pr.displayName}</td>
                <td>{Array.isArray(v) ? v.join(", ") : String(v)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LinkedListWidget(p: WidgetProps) {
  const type = p.instance.config.objectType as string;
  const link = p.instance.config.link as string;
  const pk = p.vars[p.instance.config.pkVar as string] as string | undefined;
  const [rows, setRows] = useState<Loaded[]>([]);
  const [targetType, setTargetType] = useState<string>("");
  useEffect(() => {
    if (!pk) {
      setRows([]);
      return;
    }
    fetch(`/api/objects/${type}/${encodeURIComponent(pk)}/links/${link}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setRows([]);
        setRows(d.objects ?? []);
        setTargetType(d.type ?? "");
      });
  }, [type, link, pk]);
  if (!pk) return <p className="empty">Select an object.</p>;
  return (
    <div>
      {rows.map((o) => (
        <p key={o.pk} style={{ margin: "0 0 0.35rem" }}>
          <Link className="rowlink" href={`/object/${targetType}/${encodeURIComponent(o.pk)}`}>
            {o.title ?? o.pk}
          </Link>
        </p>
      ))}
      {!rows.length && <p className="empty">Nothing linked.</p>}
    </div>
  );
}

export function ActionFormWidget(p: WidgetProps) {
  const actionApi = p.instance.config.action as string;
  const action = p.meta.actions.find((a) => a.apiName === actionApi);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  if (!action) return <p className="empty">Pick an action.</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setErrors([]);
    const res = await fetch(`/api/actions/${actionApi}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parameters: params }),
    });
    const d = await res.json();
    if (d.error) setErrors([d.error]);
    else if (d.valid === false) setErrors(d.errors ?? ["Rejected"]);
    else {
      setResult(`Applied — ${d.edits?.length ?? 0} edit(s)`);
      setParams({});
    }
  }

  return (
    <form onSubmit={submit}>
      {action.parameters.map((pr) => (
        <div key={pr.apiName} style={{ marginBottom: "0.5rem" }}>
          <label className="field-label">
            {pr.displayName ?? pr.apiName}
            {pr.required ? " *" : ""}
            {pr.type === "object_ref" ? ` (${pr.objectType} pk)` : ""}
          </label>
          {pr.type === "boolean" ? (
            <input
              type="checkbox"
              checked={Boolean(params[pr.apiName])}
              onChange={(e) => setParams((s) => ({ ...s, [pr.apiName]: e.target.checked }))}
            />
          ) : (
            <input
              className="field"
              type={pr.type === "integer" || pr.type === "double" ? "number" : "text"}
              value={(params[pr.apiName] as string) ?? ""}
              onChange={(e) =>
                setParams((s) => ({
                  ...s,
                  [pr.apiName]:
                    pr.type === "integer" || pr.type === "double"
                      ? e.target.value === "" ? undefined : Number(e.target.value)
                      : e.target.value,
                }))
              }
            />
          )}
        </div>
      ))}
      <button className="runbtn" type="submit">
        Apply {action.displayName}
      </button>
      {result && <p className="section-note" style={{ color: "var(--accent)" }}>{result}</p>}
      {errors.map((e, i) => (
        <p key={i} className="widget-err">{e}</p>
      ))}
    </form>
  );
}
