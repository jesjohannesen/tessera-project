"use client";

import { useEffect, useRef, useState } from "react";

type Group = { attr: string; storage: string; label: string; default: string; options: { value: string; label: string }[] };

const GROUPS: Group[] = [
  {
    attr: "data-theme",
    storage: "tessera-theme",
    label: "Template",
    default: "auto",
    options: [
      { value: "auto", label: "Auto" },
      { value: "teal-light", label: "Teal Light" },
      { value: "teal-dark", label: "Teal Dark" },
      { value: "paper", label: "Paper" },
      { value: "slate", label: "Slate" },
      { value: "midnight", label: "Midnight" },
      { value: "amber", label: "Amber CRT" },
    ],
  },
  {
    attr: "data-font",
    storage: "tessera-font",
    label: "Interface font",
    default: "grotesk",
    options: [
      { value: "system", label: "System" },
      { value: "grotesk", label: "Grotesk" },
      { value: "humanist", label: "Humanist" },
      { value: "geometric", label: "Geometric" },
      { value: "serif", label: "Serif" },
      { value: "mono", label: "Mono" },
    ],
  },
  {
    attr: "data-density",
    storage: "tessera-density",
    label: "Density",
    default: "comfortable",
    options: [
      { value: "compact", label: "Compact" },
      { value: "comfortable", label: "Comfortable" },
      { value: "spacious", label: "Spacious" },
    ],
  },
];

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.attr, g.default]))
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  // Reflect whatever the boot script already applied.
  useEffect(() => {
    const root = document.documentElement;
    setValues(
      Object.fromEntries(
        GROUPS.map((g) => [g.attr, root.getAttribute(g.attr) ?? g.default])
      )
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(group: Group, value: string) {
    document.documentElement.setAttribute(group.attr, value);
    try {
      localStorage.setItem(group.storage, value);
    } catch {
      /* ignore */
    }
    setValues((v) => ({ ...v, [group.attr]: value }));
  }

  return (
    <div className="settings-wrap" ref={wrapRef}>
      <button
        className="gear"
        aria-label="Appearance settings"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>
      {open && (
        <div className="settings-panel" role="dialog" aria-label="Appearance settings">
          {GROUPS.map((g) => (
            <div className="settings-group" key={g.attr}>
              <span className="label">{g.label}</span>
              <div className="seg">
                {g.options.map((o) => (
                  <button
                    key={o.value}
                    aria-pressed={values[g.attr] === o.value}
                    onClick={() => choose(g, o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
