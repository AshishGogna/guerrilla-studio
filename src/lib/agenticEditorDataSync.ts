import { addData, removeData } from "@/lib/data";

/** One user key → newline-separated file paths (stored in project data under `key`). */
export type AgenticEditorFileEntry = { key: string; paths: string };

const LINE = "\n";

/**
 * Combine path segments (each may be multiline) into a single value with **one path per line**
 * (`\\n` only). Use for lib/data and node `paths` so `${key}` and tools see clear separators.
 */
export function joinFilePathsForStorage(...segments: string[]): string {
  const lines: string[] = [];
  for (const seg of segments) {
    if (typeof seg !== "string" || !seg.trim()) continue;
    for (const part of seg.split(/\r?\n/)) {
      const t = part.trim();
      if (t) lines.push(t);
    }
  }
  return lines.join(LINE);
}

/**
 * Persists each non-empty trimmed key as a top-level data key with `paths` as value
 * (newline-separated file paths). Removes keys that were previously set by this node
 * but are no longer present.
 */
export function syncAgenticEditorFileEntriesToData(
  projectId: string,
  entries: AgenticEditorFileEntry[],
  lastPersistedKeysRef: { current: Set<string> }
): void {
  const newMap = new Map<string, string>();
  for (const row of entries) {
    const k = row.key.trim();
    if (!k) continue;
    newMap.set(k, joinFilePathsForStorage(row.paths));
  }
  const prev = lastPersistedKeysRef.current;
  for (const k of prev) {
    if (!newMap.has(k)) {
      removeData(projectId, k);
    }
  }
  for (const [k, v] of newMap) {
    addData(projectId, k, v);
  }
  lastPersistedKeysRef.current = new Set(newMap.keys());
}

export function countPathsInValue(paths: string): number {
  return paths
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}
