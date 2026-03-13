"use client";

import { useEffect, useState } from "react";
import { addData, getAll, removeData } from "@/lib/data";

export type WorldProps = { projectId: string };

function valueToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return JSON.stringify(v);
}

export default function World({ projectId }: WorldProps) {
  const [items, setItems] = useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    const all = getAll();
    setItems(
      Object.entries(all).map(([key, value]) => ({
        key,
        value: valueToString(value),
      }))
    );
  }, [projectId]);

  const addItem = () => {
    setItems((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeItem = (index: number) => {
    const item = items[index];
    if (item?.key) removeData(item.key);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateKey = (index: number, newKey: string) => {
    const oldKey = items[index]?.key ?? "";
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, key: newKey };
      return next;
    });
    if (oldKey && oldKey !== newKey) removeData(oldKey);
    if (newKey) addData(newKey, items[index]?.value ?? "");
  };

  const updateValue = (index: number, newValue: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, value: newValue };
      return next;
    });
    const key = items[index]?.key;
    if (key) addData(key, newValue);
  };

  return (
    <div className="flex-1 bg-background text-foreground p-6 overflow-auto">
      <ul className="list-none p-0 m-0 flex flex-col gap-2">
        {items.map((item, index) => (
          <li
            key={index}
            className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
          >
            <input
              type="text"
              className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
              placeholder="Key"
              value={item.key}
              onChange={(e) => updateKey(index, e.target.value)}
            />
            <input
              type="text"
              className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
              placeholder="Value"
              value={item.value}
              onChange={(e) => updateValue(index, e.target.value)}
            />
            <button
              type="button"
              className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Remove"
              onClick={() => removeItem(index)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <button
          type="button"
          className="rounded border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onClick={addItem}
        >
          +
        </button>
      </div>
    </div>
  );
}
