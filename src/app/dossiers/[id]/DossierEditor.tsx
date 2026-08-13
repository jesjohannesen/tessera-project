"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Markdown } from "@/app/components/Markdown";
import type { DossierRecord } from "@/modules/store";

interface SearchHit {
  type: string;
  typeLabel: string;
  pk: string;
  title: string | null;
}

export function DossierEditor({ dossier }: { dossier: DossierRecord }) {
  const [title, setTitle] = useState(dossier.title);
  const [body, setBody] = useState(dossier.body);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    const res = await fetch(`/api/dossiers/${dossier.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    const d = await res.json();
    setStatus(d.error ? `save failed: ${d.error}` : "saved");
  }

  async function search(query: string) {
    setQ(query);
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const d = await res.json();
    const flat: SearchHit[] = (d.groups ?? []).flatMap(
      (g: { type: string; typeLabel: string; hits: SearchHit[] }) =>
        g.hits.map((h) => ({ ...h, type: g.type, typeLabel: g.typeLabel }))
    );
    setHits(flat.slice(0, 8));
  }

  function insertMention(hit: SearchHit) {
    const token = `@[${hit.type}:${hit.pk}|${hit.title ?? hit.pk}]`;
    const ta = textRef.current;
    if (ta) {
      const start = ta.selectionStart ?? body.length;
      const end = ta.selectionEnd ?? body.length;
      setBody(body.slice(0, start) + token + body.slice(end));
    } else {
      setBody(body + token);
    }
    setQ("");
    setHits([]);
    setStatus("mention inserted — save to keep");
  }

  return (
    <main>
      <p className="mono">
        <Link href="/dossiers">Dossiers</Link>
      </p>
      <input
        className="field"
        style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: "0.6rem" }}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Dossier title"
      />

      <div className="builder-toolbar">
        <button className="runbtn" onClick={save}>Save</button>
        <div style={{ position: "relative", flex: "1", maxWidth: "24rem" }}>
          <input
            className="field"
            placeholder="Mention an entity… (search, then click to insert)"
            value={q}
            onChange={(e) => search(e.target.value)}
          />
          {hits.length > 0 && (
            <div className="mention-drop">
              {hits.map((h) => (
                <button key={`${h.type}:${h.pk}`} onClick={() => insertMention(h)}>
                  <span className="mono dim">{h.typeLabel}</span> {h.title ?? h.pk}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="section-note" style={{ margin: 0 }}>{status}</span>
      </div>

      <div className="dossier-grid">
        <div>
          <h2 style={{ marginTop: 0 }}>Source</h2>
          <textarea
            ref={textRef}
            className="field dossier-text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"# Heading\n\nWrite markdown. Mentions look like @[person:P-001|Maren Voss] — use the search box above to insert them."}
          />
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Rendered</h2>
          <div className="panel" style={{ padding: "1rem 1.2rem" }}>
            <Markdown text={body || "*Nothing yet.*"} />
          </div>
        </div>
      </div>
    </main>
  );
}
