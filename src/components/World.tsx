"use client";

import { useEffect, useState } from "react";
import { generateImage } from "@/lib/ai";
import { addData, getAll, getData, removeData } from "@/lib/data";

export type WorldProps = { projectId: string };

function valueToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return JSON.stringify(v);
}

export default function World({ projectId }: WorldProps) {
  const [items, setItems] = useState<{ key: string; value: string }[]>([]);
  const [generatingObjectRefs, setGeneratingObjectRefs] = useState(false);

  useEffect(() => {
    const all = getAll(projectId);
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
    if (item?.key) removeData(projectId, item.key);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateKey = (index: number, newKey: string) => {
    const oldKey = items[index]?.key ?? "";
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, key: newKey };
      return next;
    });
    if (oldKey && oldKey !== newKey) removeData(projectId, oldKey);
    if (newKey) addData(projectId, newKey, items[index]?.value ?? "");
  };

  const updateValue = (index: number, newValue: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, value: newValue };
      return next;
    });
    const key = items[index]?.key;
    if (key) addData(projectId, key, newValue);
  };

  const refreshItems = () => {
    const all = getAll(projectId);
    setItems(
      Object.entries(all).map(([key, value]) => ({
        key,
        value: valueToString(value),
      }))
    );
  };

  const handleGenerateObjectReferences = async () => {
    let raw = getData(projectId, "references");
    if (!Array.isArray(raw)) {
      raw = JSON.parse(raw);
      if (!Array.isArray(raw)) {
        alert('No object references found. Save a list under data.objectReferences first.');
        return;
      }
    }
    const refs = raw as unknown[];
    const parsed = refs
      .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null))
      .filter(Boolean)
      .map((r) => ({
        id: typeof r!.id === "string" ? r!.id : "",
        imageGenerationPrompt:
          typeof r!.imageGenerationPrompt === "string" ? r!.imageGenerationPrompt : "",
      }))
      .filter((r) => r.id.trim() && r.imageGenerationPrompt.trim());

    if (parsed.length === 0) {
      alert('objectReferences is empty or invalid. Expected items like { id, imageGenerationPrompt }.');
      return;
    }

    //gemini-2.5-flash-image
    //gemini-3-pro-image-preview
    setGeneratingObjectRefs(true);
    try {
      for (const obj of parsed) {
        const fileName = `object-${obj.id}`;
        const imagePath = await generateImage(
          obj.imageGenerationPrompt,
          projectId,
          fileName,
          "1:1",
          undefined,
          "gemini-2.5-flash-image"
        );
        addData(projectId, obj.id, imagePath);
      }
      refreshItems();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to generate object references");
    } finally {
      setGeneratingObjectRefs(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-foreground/10 bg-foreground/5 px-6 py-3">
        <button
          type="button"
          onClick={handleGenerateObjectReferences}
          disabled={generatingObjectRefs}
          className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generatingObjectRefs ? "Generating…" : "Generate Object References"}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6">
      <ul className="list-none p-0 m-0 flex flex-col gap-2">
        {items.map((item, index) => (
          <li
            key={index}
            className="flex items-center gap-2 bg-card p-2"
          >
            <input
              type="text"
              className="min-w-0 flex-1 rounded border border-foreground/10 bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
              placeholder="Key"
              value={item.key}
              onChange={(e) => updateKey(index, e.target.value)}
            />
            <input
              type="text"
              className="min-w-0 flex-1 rounded border border-foreground/10 bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
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
    </div>
  );
}
