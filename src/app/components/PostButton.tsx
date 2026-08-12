"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PostButton({
  url,
  body,
  label,
  busyLabel,
}: {
  url: string;
  body?: Record<string, unknown>;
  label: string;
  busyLabel?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <button className="runbtn" onClick={run} disabled={busy}>
      {busy ? (busyLabel ?? "Working…") : label}
    </button>
  );
}
