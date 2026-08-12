"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TYPE_COLORS } from "@/explore/facets";

interface GNode {
  id: string;
  type: string;
  pk: string;
  title: string | null;
  seed?: boolean;
}
interface GEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  fromEdit: boolean;
}
interface SimNode extends GNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

const W = 900;
const H = 560;

export function GraphView({
  initial,
  seedType,
  seedPk,
}: {
  initial: { nodes: GNode[]; edges: GEdge[] };
  seedType: string;
  seedPk: string;
}) {
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [loading, setLoading] = useState(false);
  const nodesRef = useRef<SimNode[]>([]);
  const dragRef = useRef<{ id: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number>(0);

  /** Union of what's on screen and what just arrived: existing nodes keep
   *  their positions, new ones spawn near the node they expanded from. */
  const seedInto = useCallback(
    (raw: { nodes: GNode[]; edges: GEdge[] }, existingNodes: SimNode[], origin?: SimNode) => {
      const byId = new Map(existingNodes.map((n) => [n.id, n]));
      for (const n of raw.nodes) {
        const prev = byId.get(n.id);
        if (prev) {
          // Preserve position/velocity; refresh metadata, but never let a
          // later fetch clear the original seed flag.
          byId.set(n.id, { ...prev, ...n, seed: prev.seed || n.seed });
          continue;
        }
        const cx = origin?.x ?? W / 2;
        const cy = origin?.y ?? H / 2;
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 70;
        byId.set(n.id, {
          ...n,
          seed: false,
          x: Math.max(20, Math.min(W - 20, cx + Math.cos(angle) * dist)),
          y: Math.max(20, Math.min(H - 20, cy + Math.sin(angle) * dist)),
          vx: 0,
          vy: 0,
        });
      }
      return [...byId.values()];
    },
    []
  );

  // Initialize.
  useEffect(() => {
    const init = seedInto(initial, []);
    const seed = init.find((n) => n.seed);
    if (seed) {
      seed.x = W / 2;
      seed.y = H / 2;
    }
    setNodes(init);
    setEdges(initial.edges);
    setSelected(seed ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Force simulation loop.
  useEffect(() => {
    const edgeList = edges;
    function tick() {
      const ns = nodesRef.current;
      if (ns.length) {
        const idIndex = new Map(ns.map((n, i) => [n.id, i]));
        // Repulsion.
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const a = ns[i];
            const b = ns[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) {
              dx = Math.random();
              dy = Math.random();
              d2 = 1;
            }
            const force = 5200 / d2;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * force;
            const fy = (dy / d) * force;
            a.vx += fx;
            a.vy += fy;
            b.vx -= fx;
            b.vy -= fy;
          }
        }
        // Springs.
        for (const e of edgeList) {
          const ai = idIndex.get(e.source);
          const bi = idIndex.get(e.target);
          if (ai == null || bi == null) continue;
          const a = ns[ai];
          const b = ns[bi];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const k = (d - 130) * 0.02;
          const fx = (dx / d) * k;
          const fy = (dy / d) * k;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
        // Centering + integrate.
        for (const n of ns) {
          n.vx += (W / 2 - n.x) * 0.0014;
          n.vy += (H / 2 - n.y) * 0.0014;
          n.vx *= 0.86;
          n.vy *= 0.86;
          if (!n.fixed && dragRef.current?.id !== n.id) {
            n.x = Math.max(20, Math.min(W - 20, n.x + n.vx));
            n.y = Math.max(20, Math.min(H - 20, n.y + n.vy));
          }
        }
        setNodes([...ns]);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [edges]);

  async function expand(node: GNode) {
    setSelected(node);
    setLoading(true);
    try {
      const res = await fetch(`/api/graph?type=${node.type}&pk=${encodeURIComponent(node.pk)}&hops=1`);
      const data: { nodes: GNode[]; edges: GEdge[] } = await res.json();
      setNodes((prev) => {
        const origin = prev.find((n) => n.id === node.id);
        const merged = seedInto(data, prev, origin);
        nodesRef.current = merged;
        return merged;
      });
      setEdges((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...data.edges.filter((e) => !seen.has(e.id))];
      });
    } finally {
      setLoading(false);
    }
  }

  // Pointer → svg coordinates.
  function toSvg(clientX: number, clientY: number) {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  }

  const edgeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const legendTypes = useMemo(() => [...new Set(nodes.map((n) => n.type))], [nodes]);

  return (
    <div className="graph-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const { x, y } = toSvg(e.clientX, e.clientY);
          const n = nodesRef.current.find((nn) => nn.id === dragRef.current!.id);
          if (n) {
            n.x = x;
            n.y = y;
            n.vx = 0;
            n.vy = 0;
          }
        }}
        onPointerUp={() => (dragRef.current = null)}
        onPointerLeave={() => (dragRef.current = null)}
      >
        {edges.map((e) => {
          const a = edgeMap.get(e.source);
          const b = edgeMap.get(e.target);
          if (!a || !b) return null;
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--line)"
              strokeWidth={1.4}
            />
          );
        })}
        {nodes.map((n) => {
          const color = TYPE_COLORS[n.type] ?? "var(--muted)";
          const r = n.seed ? 11 : selected?.id === n.id ? 9 : 7;
          return (
            <g key={n.id} style={{ cursor: "pointer" }}>
              <circle
                cx={n.x}
                cy={n.y}
                r={r}
                fill={color}
                stroke={selected?.id === n.id ? "var(--ink)" : "var(--surface)"}
                strokeWidth={selected?.id === n.id ? 2.5 : 1.5}
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  dragRef.current = { id: n.id };
                  setSelected(n);
                }}
                onClick={() => expand(n)}
              />
              <text className="graph-node-label" x={n.x + r + 3} y={n.y + 3}>
                {(n.title ?? n.pk).slice(0, 22)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="graph-legend">
        {legendTypes.map((t) => (
          <span key={t}>
            <span className="dot" style={{ background: TYPE_COLORS[t] ?? "var(--muted)" }} />
            {t}
          </span>
        ))}
      </div>

      {selected && (
        <div className="graph-info">
          <div className="mono" style={{ marginBottom: 4 }}>{selected.type}</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{selected.title ?? selected.pk}</div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="runbtn" onClick={() => expand(selected)} disabled={loading}>
              {loading ? "Expanding…" : "Search around"}
            </button>
            <Link className="runbtn" href={`/object/${selected.type}/${encodeURIComponent(selected.pk)}`}>
              Open
            </Link>
          </div>
        </div>
      )}

      <div className="graph-hint">
        {nodes.length} nodes · {edges.length} links · seeded from {seedType} {seedPk}
      </div>
    </div>
  );
}
