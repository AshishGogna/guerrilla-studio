import JSZip from "jszip";
import { getScenesArrayFromProject } from "@/lib/storyboardNumericPrompt";
import { loadStoryboardState } from "@/lib/state-storage";

function extractVideoPromptFromScene(scene: unknown): string {
  if (typeof scene === "string") return "";
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

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

/** Last valid scene index (0-based) for range UI and download. */
export function getStoryboardLastSceneIndex(projectId: string): number {
  const scenes = getScenesArrayFromProject(projectId);
  const { panels } = loadStoryboardState(projectId);
  return Math.max(0, Math.max(panels.length, scenes.length) - 1);
}

/**
 * Copy video prompts in range to clipboard and download panel images as zip.
 * The zip includes `videoGenerationPrompts.txt` with the same prompt text (Storyboard node "Download & Copy").
 */
export async function runStoryboardDownloadAndCopy(
  projectId: string,
  fromScene: number,
  toScene: number
): Promise<void> {
  const scenes = getScenesArrayFromProject(projectId);
  const { panels } = loadStoryboardState(projectId);
  const last = Math.max(0, Math.max(panels.length, scenes.length) - 1);

  let from = fromScene;
  let to = toScene;
  if (Number.isNaN(from)) from = 0;
  if (Number.isNaN(to)) to = last;
  from = Math.max(0, Math.min(from, last));
  to = Math.max(0, Math.min(to, last));
  if (from > to) [from, to] = [to, from];

  const notes: string[] = [];

  const promptParts: string[] = [];
  for (let i = from; i <= to; i++) {
    const panel = panels[i];
    let v = panel?.promptVideo?.trim() ?? "";
    if (!v && scenes[i] !== undefined) {
      v = extractVideoPromptFromScene(scenes[i]).trim();
    }
    promptParts.push(v);
  }
  const nonEmptyPrompts = promptParts.filter((p) => p.length > 0);
  if (nonEmptyPrompts.length === 0) {
    notes.push("No video generation prompts in this range.");
  } else {
    await copyTextToClipboard(nonEmptyPrompts.join("\n\n"));
  }

  const zip = new JSZip();
  const folder = zip.folder(`${projectId}-panels-${from}-${to}`);
  let zipCount = 0;
  for (let i = from; i <= to; i++) {
    const url = panels[i]?.imageUrl;
    if (!url) continue;
    const fullUrl = url.startsWith("/") ? `${window.location.origin}${url}` : url;
    const res = await fetch(fullUrl);
    if (!res.ok) continue;
    const blob = await res.blob();
    const ext = url.split(".").pop()?.toLowerCase() || "png";
    folder?.file(`panel-${i}.${ext}`, blob);
    zipCount += 1;
  }
  if (zipCount > 0) {
    const promptsForZip =
      nonEmptyPrompts.length > 0 ? nonEmptyPrompts.join("\n\n") : "";
    folder?.file("videoGenerationPrompts.txt", promptsForZip);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${projectId}-panels-${from}-${to}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  } else {
    notes.push("No panel images in this range to download.");
  }

  if (notes.length > 0) {
    alert(notes.join("\n\n"));
  }
}
