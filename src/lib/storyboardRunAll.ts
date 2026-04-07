/**
 * Headless "import scenes + generate all panels" used by the Storyboard node.
 * Mirrors Storyboarding.tsx Import Scenes + per-panel generation (refs, file:// upload).
 */

import { addData, getAll, getData, removeData } from "@/lib/data";
import { resolvePanelIndexFromNumericPrompt } from "@/lib/storyboardNumericPrompt";
import {
  loadStoryboardState,
  saveStoryboardState,
  type StoryboardPanelPersisted,
} from "@/lib/state-storage";
import { notifyStoryboardStateChanged } from "@/lib/storyboardStateEvent";

/** Same as Storyboarding: public paths must be root-absolute for fetch. */
function normalizePublicAssetUrl(url: string | null): string | null {
  if (url == null || url === "") return url;
  if (
    url.startsWith("/") ||
    url.startsWith("blob:") ||
    url.startsWith("data:") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  ) {
    return url;
  }
  return `/${url}`;
}

async function fetchUrlAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Panel index → image path from persisted storyboard (before a reset). */
function captureExistingStoryboardImagesByIndex(
  projectId: string,
  all: Record<string, unknown>
): Map<number, string> {
  const byIndex = new Map<number, string>();
  const persisted = loadStoryboardState(projectId);
  persisted.panels.forEach((panel, i) => {
    const u = panel.imageUrl;
    if (typeof u === "string" && u.trim()) byIndex.set(i, u.trim());
  });
  for (const key of Object.keys(all)) {
    const m = key.match(/^storyboard\[(\d+)\]$/);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const val = all[key];
    if (typeof val === "string" && val.trim() && !byIndex.has(idx)) {
      byIndex.set(idx, val.trim());
    }
  }
  return byIndex;
}

/**
 * Clears storyboard data keys, imports panels from data.scenes (with referenceImages),
 * then generates each panel image and persists state + data.storyboard[i].
 */
export async function executeStoryboardRunAll(
  projectId: string,
  opts?: { preserveExistingImages?: boolean }
): Promise<void> {
  const preserveExistingImages = opts?.preserveExistingImages !== false;
  const all = getAll(projectId);
  const previousImagesByIndex = preserveExistingImages
    ? captureExistingStoryboardImagesByIndex(projectId, all)
    : new Map<number, string>();

  // 1) Clear storyboard data keys
  Object.keys(all)
    .filter((k) => k.startsWith("storyboard"))
    .forEach((k) => removeData(projectId, k));

  // 2) Import scenes -> panels
  let scenesRaw: unknown = getData(projectId, "scenes");
  if (!Array.isArray(scenesRaw)) {
    scenesRaw = JSON.parse(String(scenesRaw ?? "null")) as unknown;
  }
  const scenesArr = Array.isArray(scenesRaw) ? Array.from(scenesRaw as unknown[]) : [];
  if (scenesArr.length === 0) {
    alert("No scenes found in data.scenes.");
    return;
  }

  const panels: StoryboardPanelPersisted[] = await Promise.all(
    scenesArr.map(async (scene) => {
      const sceneObj =
        typeof scene === "object" && scene !== null ? (scene as Record<string, unknown>) : null;
      const imageGenerationPrompt =
        sceneObj && "imageGenerationPrompt" in sceneObj
          ? String(sceneObj.imageGenerationPrompt ?? "")
          : "";
      const prompt =
        typeof scene === "string"
          ? scene
          : sceneObj && "prompt" in sceneObj
            ? String(sceneObj.prompt ?? "")
            : sceneObj && "promptImage" in sceneObj
              ? String(sceneObj.promptImage ?? "")
              : sceneObj && "description" in sceneObj
                ? String(sceneObj.description ?? "")
                : "";
      const referenceImages: { url: string }[] = [];
      const refEntries =
        sceneObj && "references" in sceneObj && Array.isArray(sceneObj.references)
          ? (sceneObj.references as unknown[]).filter((r): r is string => typeof r === "string")
          : [];
      for (const ref of refEntries) {
        const key = ref.startsWith("data.") ? ref.slice(5).trim() : ref.trim();
        if (!key) continue;
        const pathValue = getData(projectId, key);
        if (typeof pathValue !== "string" || !pathValue.trim()) continue;
        let url = pathValue.trim();
        if (url.startsWith("file://")) {
          try {
            const upRes = await fetch("/api/upload-from-path", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId, filePath: url }),
            });
            const upData = await upRes.json();
            if (upRes.ok && typeof upData?.filePath === "string") {
              url = normalizePublicAssetUrl(upData.filePath) ?? upData.filePath;
            }
          } catch {
            // skip this reference on upload failure
          }
        }
        referenceImages.push({ url });
      }
      return {
        imageUrl: null,
        promptImage: imageGenerationPrompt || prompt,
        promptVideo: "",
        mode: "image" as const,
        referenceImages,
      };
    })
  );

  if (preserveExistingImages) {
    for (let i = 0; i < panels.length; i++) {
      const kept = previousImagesByIndex.get(i);
      if (kept) {
        const normalized = normalizePublicAssetUrl(kept) ?? kept;
        panels[i] = { ...panels[i], imageUrl: normalized };
      }
    }
  }

  const prev = loadStoryboardState(projectId);
  saveStoryboardState(projectId, { ...prev, panels });

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const promptTrimmed = (p.promptImage ?? "").trim();
    if (!promptTrimmed) continue;

    if (preserveExistingImages) {
      const existingPath =
        typeof p.imageUrl === "string" && p.imageUrl.trim() ? p.imageUrl.trim() : "";
      if (existingPath) {
        addData(projectId, `storyboard[${i}]`, existingPath);
        saveStoryboardState(projectId, { ...loadStoryboardState(projectId), panels });
        continue;
      }
    }

    // Digits-only prompt = reuse that scene/panel's image (Storyboarding behavior). Never send "3" to Gemini.
    if (/^\d+$/.test(promptTrimmed)) {
      const num = parseInt(promptTrimmed, 10);
      const srcIdx = resolvePanelIndexFromNumericPrompt(num, panels.length, scenesArr);
      let reusedPath: string | null = null;
      if (srcIdx >= 0) {
        const fromPanel = panels[srcIdx]?.imageUrl;
        if (typeof fromPanel === "string" && fromPanel.trim()) {
          reusedPath = fromPanel.trim();
        } else {
          const fromData = getData(projectId, `storyboard[${srcIdx}]`);
          if (typeof fromData === "string" && fromData.trim()) {
            reusedPath = fromData.trim();
          }
        }
      }
      if (reusedPath) {
        panels[i] = { ...panels[i], imageUrl: reusedPath };
        addData(projectId, `storyboard[${i}]`, reusedPath);
        saveStoryboardState(projectId, { ...loadStoryboardState(projectId), panels });
        continue;
      }
      throw new Error(
        srcIdx < 0
          ? `Panel ${i}: image prompt "${promptTrimmed}" does not match any sceneNumber or panel index.`
          : `Panel ${i}: image prompt "${promptTrimmed}" points to scene/panel ${srcIdx}, but that panel has no image yet.`
      );
    }

    const attachedImages =
      p.referenceImages.length > 0
        ? await Promise.all(
            p.referenceImages.map(async (ref, j) => ({
              fileName: `ref-${j}.png`,
              base64: await fetchUrlAsBase64(ref.url),
            }))
          )
        : undefined;

    const res = await fetch("/api/generate-panel-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptTrimmed,
        model: prev.imageModel ?? "gemini-2.5-flash-image",
        outputFileName: `panel-${i}`,
        aspectRatio: prev.aspectRatio ?? "16:9",
        attachedImages: attachedImages ?? [],
        projectId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "Failed to generate image");
    if (typeof data?.content !== "string") throw new Error("Invalid response from server");
    const imagePath = data.content as string;

    panels[i] = { ...panels[i], imageUrl: imagePath };
    addData(projectId, `storyboard[${i}]`, imagePath);
    saveStoryboardState(projectId, { ...loadStoryboardState(projectId), panels });
  }

  notifyStoryboardStateChanged(projectId);
}
