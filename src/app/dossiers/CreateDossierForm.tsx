"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateDossierForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const res = await fetch("/api/dossiers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    const d = await res.json();
    if (!d.error) router.push(`/dossiers/${d.id}`);
  }

  return (
    <form onSubmit={create} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <input
        className="field"
        style={{ maxWidth: "20rem" }}
        placeholder="New dossier title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button className="runbtn" type="submit">Create dossier</button>
    </form>
  );
}
