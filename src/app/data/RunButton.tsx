"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunButton({
  kind,
  target,
  label,
}: {
  kind: "sync" | "build";
  target?: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await fetch("/api/data/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, target }),
      });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <button className="runbtn" onClick={run} disabled={busy}>
      {busy ? "Running…" : label}
    </button>
  );
}
