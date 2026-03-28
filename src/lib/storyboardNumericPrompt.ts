/**
 * Scenes may use imageGenerationPrompt = "3" to reuse the image from sceneNumber 3
 * (or panel index 3 when no scene matches). Resolves that to a panel array index.
 */

import { getData } from "@/lib/data";

export function getScenesArrayFromProject(projectId: string): unknown[] {
  let scenesRaw: unknown = getData(projectId, "scenes");
  if (!Array.isArray(scenesRaw)) {
    try {
      scenesRaw = JSON.parse(String(scenesRaw ?? "null")) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(scenesRaw) ? Array.from(scenesRaw as unknown[]) : [];
}

/**
 * @param numeric — value parsed from a digits-only image prompt (e.g. sceneNumber or index)
 */
export function resolvePanelIndexFromNumericPrompt(
  numeric: number,
  panelsLength: number,
  scenesArr: unknown[]
): number {
  const bySceneNumber = scenesArr.findIndex((scene) => {
    const o = typeof scene === "object" && scene !== null ? (scene as Record<string, unknown>) : null;
    if (!o || !("sceneNumber" in o)) return false;
    const sn = Number(o.sceneNumber);
    return Number.isFinite(sn) && sn === numeric;
  });
  if (bySceneNumber >= 0) return bySceneNumber;
  if (numeric >= 0 && numeric < panelsLength) return numeric;
  return -1;
}
