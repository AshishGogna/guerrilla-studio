import { getScenesArrayFromProject } from "@/lib/storyboardNumericPrompt";
import { loadStoryboardState } from "@/lib/state-storage";

/**
 * Same field extraction as Storyboarding “Copy Video Gen Prompts for Grok”
 * (string scene → full string; objects → videoGenerationPrompt / video_prompt / videoPrompt / promptVideo).
 */
export function extractVideoGenPromptFromSceneForGrokCopy(scene: unknown): string {
  if (typeof scene === "string") return scene;
  const obj =
    scene && typeof scene === "object" ? (scene as Record<string, unknown>) : null;
  if (!obj) return "";
  if ("videoGenerationPrompt" in obj) {
    return String(
      (obj as { videoGenerationPrompt?: unknown }).videoGenerationPrompt ?? ""
    );
  }
  if ("video_prompt" in obj) {
    return String((obj as { video_prompt?: unknown }).video_prompt ?? "");
  }
  if ("videoPrompt" in obj) {
    return String((obj as { videoPrompt?: unknown }).videoPrompt ?? "");
  }
  if ("promptVideo" in obj) {
    return String((obj as { promptVideo?: unknown }).promptVideo ?? "");
  }
  return "";
}

/**
 * Text the “Copy Video Gen Prompts for Grok” button puts on the clipboard:
 * non-empty trimmed prompts only, separated by `\n\n`.
 */
export function getCopyVideoGenPromptsForGrokClipboardText(projectId: string): string {
  const raw = getScenesArrayFromProject(projectId);
  const prompts = raw
    .map((scene) => extractVideoGenPromptFromSceneForGrokCopy(scene).trim())
    .filter((s) => s.length > 0);
  return prompts.join("\n\n");
}

/** Turn panel image URL into a path `/api/grok-automation-read-images` can resolve. */
export function normalizeStoryboardPanelImageUrl(url: string): string {
  const u = url.trim();
  if (!u) return "";
  if (u.startsWith("/projects/")) return u;
  if (typeof window !== "undefined") {
    try {
      if (u.startsWith("http://") || u.startsWith("https://")) {
        const parsed = new URL(u);
        return parsed.pathname || u;
      }
    } catch {
      // ignore
    }
  }
  return u;
}

/**
 * One entry per storyboard panel that has `imageUrl`, in panel order.
 * Prompts use the same extraction as “Copy Video Gen Prompts for Grok”, aligned by scene index (may be empty).
 */
export function collectGrokAutomationFromStoryboard(projectId: string): {
  paths: string[];
  promptLines: string[];
  imagePathsStorage: string;
  promptsStorage: string;
} {
  const { panels } = loadStoryboardState(projectId);
  const scenes = getScenesArrayFromProject(projectId);
  const paths: string[] = [];
  const promptLines: string[] = [];

  for (let i = 0; i < panels.length; i++) {
    const rawUrl = panels[i]?.imageUrl?.trim();
    if (!rawUrl) continue;
    paths.push(normalizeStoryboardPanelImageUrl(rawUrl));
    promptLines.push(extractVideoGenPromptFromSceneForGrokCopy(scenes[i]).trim());
  }

  return {
    paths,
    promptLines,
    imagePathsStorage: paths.join("\n"),
    promptsStorage: promptLines.join("\n\n"),
  };
}
