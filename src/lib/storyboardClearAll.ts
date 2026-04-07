import { getAll, removeData } from "@/lib/data";
import { loadStoryboardState, saveStoryboardState } from "@/lib/state-storage";
import { notifyStoryboardStateChanged } from "@/lib/storyboardStateEvent";

/**
 * Mirrors the Storyboarding "Clear" button, but as a reusable function.
 * - Removes all `storyboard*` keys from lib/data
 * - Clears storyboard state images so future runs can't reuse them
 */
export function clearStoryboardAll(projectId: string): void {
  const all = getAll(projectId);
  Object.keys(all)
    .filter((k) => k.startsWith("storyboard"))
    .forEach((k) => removeData(projectId, k));

  const prev = loadStoryboardState(projectId);
  saveStoryboardState(projectId, {
    ...prev,
    panels: prev.panels.map((p) => ({ ...p, imageUrl: null })),
  });

  notifyStoryboardStateChanged(projectId);
}

