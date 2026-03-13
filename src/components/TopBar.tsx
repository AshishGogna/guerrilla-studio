"use client";

import { ReactNode, useState } from "react";
import { getAll, removeAll, removeData } from "@/lib/data";

interface TopBarProps {
  title?: string;
  children?: ReactNode;
}

export default function TopBar({ title = "", children }: TopBarProps) {
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [entries, setEntries] = useState<[string, unknown][]>([]);

  const openDataModal = () => {
    setEntries(Object.entries(getAll()));
    setDataModalOpen(true);
  };

  const handleRemove = (key: string) => {
    removeData(key);
    setEntries(Object.entries(getAll()));
  };

  const handleRemoveAll = () => {
    removeAll();
    setEntries([]);
  };

  return (
    <div className="shrink-0 border-b border-foreground/10 bg-background">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {title && (
            <h1 className="font-mono text-sm uppercase tracking-wider text-foreground/70">
              {title}
            </h1>
          )}
          {children}
        </div>
        <button
          type="button"
          className="rounded px-2 py-1 font-mono text-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
          title="View stored data"
          onClick={openDataModal}
        >
          {"{ }"}
        </button>
      </div>

      {dataModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setDataModalOpen(false)}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-lg w-[90vw] max-w-lg max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-mono text-sm font-medium text-foreground">
                Stored data
              </h2>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setDataModalOpen(false)}
              >
                ×
              </button>
            </div>
            <ul className="flex-1 overflow-auto p-4 space-y-2 list-none m-0">
              {entries.length === 0 ? (
                <li className="text-sm text-muted-foreground">No entries</li>
              ) : (
                entries.map(([key, value]) => (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-2 rounded border border-border bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-sm text-foreground">
                        {key}
                      </span>
                      <span className="text-muted-foreground text-sm truncate block">
                        {typeof value === "object" && value !== null
                          ? JSON.stringify(value)
                          : String(value)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      onClick={() => handleRemove(key)}
                    >
                      Delete
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
              <button
                type="button"
                className="rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                onClick={() => setDataModalOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/10 transition-colors"
                onClick={handleRemoveAll}
                disabled={entries.length === 0}
              >
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
