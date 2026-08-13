"use client";

import { useState } from "react";

interface DisplayItem {
  kind: "text" | "tool";
  text?: string;
  tool?: string;
  input?: string;
  result?: string;
}
interface ChatEntry {
  role: "user" | "agent";
  items: DisplayItem[];
}

export function ChatPanel() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [apiMessages, setApiMessages] = useState<unknown[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setEntries((prev) => [...prev, { role: "user", items: [{ kind: "text", text: message }] }]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, apiMessages }),
      });
      const d = await res.json();
      if (d.error) {
        setEntries((prev) => [...prev, { role: "agent", items: [{ kind: "text", text: `⚠ ${d.error}` }] }]);
      } else {
        setApiMessages(d.apiMessages ?? []);
        setEntries((prev) => [...prev, { role: "agent", items: d.display ?? [] }]);
      }
    } catch (err) {
      setEntries((prev) => [...prev, { role: "agent", items: [{ kind: "text", text: `⚠ ${String(err)}` }] }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel chat-panel">
      <div className="chat-log">
        {entries.map((entry, i) => (
          <div key={i} className={`chat-entry ${entry.role}`}>
            <span className="mono dim">{entry.role === "user" ? "you" : "analyst"}</span>
            {entry.items.map((item, j) =>
              item.kind === "text" ? (
                <p key={j}>{item.text}</p>
              ) : (
                <details key={j} className="chat-tool">
                  <summary>
                    <code className="inline">{item.tool}</code> {item.input}
                  </summary>
                  <pre>{item.result}</pre>
                </details>
              )
            )}
          </div>
        ))}
        {busy && <p className="section-note">Analyst is working…</p>}
        {!entries.length && (
          <p className="empty">
            Ask about the ontology — e.g. “Which organizations own vessels?”, “How many RU persons
            are on both watchlists?”, or “Add a note to person P-001” (writes are staged for your
            review below).
          </p>
        )}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input
          className="field"
          placeholder="Ask the analyst…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="runbtn" type="submit" disabled={busy}>
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
