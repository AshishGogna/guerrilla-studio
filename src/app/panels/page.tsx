"use client";

import { useState } from "react";

export default function PanelsPage() {
  const [scriptOpen, setScriptOpen] = useState(true);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Toggle strip: always visible on the left */}
      <div className="flex w-8 shrink-0 flex-col items-center border-r border-foreground/10 bg-background">
        <button
          type="button"
          onClick={() => setScriptOpen((open) => !open)}
          className="flex h-12 w-8 items-center justify-center text-foreground/60 transition hover:text-foreground"
          title={scriptOpen ? "Collapse Script" : "Expand Script"}
          aria-label={scriptOpen ? "Collapse Script" : "Expand Script"}
        >
          {scriptOpen ? "◀" : "▶"}
        </button>
      </div>

      {/* Script panel: 20% width or 0, full height */}
      <div
        className="flex shrink-0 flex-col overflow-hidden border-r border-foreground/10 transition-[width] duration-200 ease-out"
        style={{ width: scriptOpen ? "20%" : 0 }}
      >
        <label
          htmlFor="script"
          className="shrink-0 border-b border-foreground/10 px-4 py-2 font-mono text-sm uppercase tracking-wider text-foreground/70"
        >
          Script
        </label>
        <textarea
          id="script"
          name="script"
          placeholder="Paste or type script…"
          className="min-h-0 min-w-[200px] flex-1 resize-none border-0 bg-transparent px-4 py-3 font-mono text-[12pt] leading-relaxed text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0"
          style={{ fontFamily: "Cursor, var(--font-mono), ui-monospace, monospace" }}
        />
        <div className="shrink-0 border-t border-foreground/10 p-3">
          <button
            type="button"
            className="w-full rounded bg-accent px-3 py-2 text-sm font-semibold text-background transition hover:bg-accent-muted"
          >
            Generate Panel Prompts
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="min-w-0 flex-1" />
    </div>
  );
}
