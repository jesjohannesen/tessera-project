"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateModuleForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const displayName = name.trim();
    if (!displayName) return;
    const apiName = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const res = await fetch("/api/modules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiName, displayName }),
    });
    const d = await res.json();
    if (d.error) setError(d.error);
    else router.push(`/modules/${d.id}/edit`);
  }

  return (
    <form onSubmit={create} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <input
        className="field"
        style={{ maxWidth: "20rem" }}
        placeholder="New module name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button className="runbtn" type="submit">Create module</button>
      {error && <span className="widget-err">{error}</span>}
    </form>
  );
}
