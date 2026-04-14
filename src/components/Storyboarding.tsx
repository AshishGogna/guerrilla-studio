"use client";

import { generateImage } from "@/lib/ai";
import { searchImage } from "@/lib/Search";
import { addData, getData, getAll, removeData } from "@/lib/data";
import {
  loadStoryboardState,
  saveStoryboardState,
  type StoryboardPanelPersisted,
} from "@/lib/state-storage";
import {
  getScenesArrayFromProject,
  resolvePanelIndexFromNumericPrompt,
} from "@/lib/storyboardNumericPrompt";
import JSZip from "jszip";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clearStoryboardAll } from "@/lib/storyboardClearAll";
import {
  STORYBOARD_STATE_CHANGED_EVENT,
  notifyStoryboardStateChanged,
} from "@/lib/storyboardStateEvent";
import { getCopyVideoGenPromptsForGrokClipboardText } from "@/lib/grokStoryboardSource";

const MIN_TEXTAREA_HEIGHT = 44;

/** Public files under /public — must start with / or img/fetch breaks on routes like /panels/id */
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

const IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
] as const;
const ASPECT_RATIOS = ["1:1", "16:9", "9:16"] as const;
const SCALES = ["1x", "2x"] as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Fetch same-origin image URL and return as data URL (for API). */
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

function normalizeDataRefKey(ref: string): string {
  const trimmed = ref.trim();
  return trimmed.startsWith("data.") ? trimmed.slice(5).trim() : trimmed;
}

function extractSceneReferenceDataKeys(sceneObj: Record<string, unknown> | null): string[] {
  const refEntries =
    sceneObj && "references" in sceneObj && Array.isArray(sceneObj.references)
      ? (sceneObj.references as unknown[]).filter((r): r is string => typeof r === "string")
      : [];
  return refEntries.map(normalizeDataRefKey).filter(Boolean);
}

function resizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.max(MIN_TEXTAREA_HEIGHT, el.scrollHeight)}px`;
}

type PanelMode = "image" | "video";

/** File URL from upload-attachment (or loaded from state). */
interface RefImage {
  url: string;
}

interface PanelItem {
  imageUrl: string | null;
  promptImage: string;
  promptVideo: string;
  mode: PanelMode;
  referenceImages: RefImage[];
  referenceDataKeys: string[];
  generating: boolean;
}

const defaultPanel: PanelItem = {
  imageUrl: null,
  promptImage: "",
  promptVideo: "",
  mode: "image",
  referenceImages: [],
  referenceDataKeys: [],
  generating: false,
};

function persistedToPanel(p: StoryboardPanelPersisted & { prompt?: string; imageModel?: string }): PanelItem {
  return {
    imageUrl: normalizePublicAssetUrl(p.imageUrl),
    promptImage: p.promptImage ?? (p as { prompt?: string }).prompt ?? "",
    promptVideo: p.promptVideo ?? "",
    mode: p.mode === "video" ? "video" : "image",
    referenceImages: p.referenceImages.map((r) => ({
      url: normalizePublicAssetUrl(r.url) ?? r.url,
    })),
    referenceDataKeys: Array.isArray(p.referenceDataKeys)
      ? p.referenceDataKeys.filter((k): k is string => typeof k === "string" && k.trim() !== "")
      : [],
    generating: false,
  };
}

function panelToPersisted(panel: PanelItem): StoryboardPanelPersisted {
  return {
    imageUrl: panel.imageUrl?.startsWith("blob:") ? null : panel.imageUrl,
    promptImage: panel.promptImage,
    promptVideo: panel.promptVideo,
    mode: panel.mode,
    referenceImages: panel.referenceImages.map((r) => ({ url: r.url })),
    referenceDataKeys: panel.referenceDataKeys,
  };
}

export type StoryboardingProps = { projectId: string };

export default function Storyboarding({ projectId }: StoryboardingProps) {
  const [panels, setPanels] = useState<PanelItem[]>(() => {
    if (typeof window === "undefined") return [{ ...defaultPanel }];
    const saved = loadStoryboardState(projectId);
    if (!saved.panels?.length) return [{ ...defaultPanel }];
    return saved.panels.map(persistedToPanel);
  });
  const [imageModel, setImageModel] = useState<string>(() => {
    if (typeof window === "undefined") return IMAGE_MODELS[0];
    const saved = loadStoryboardState(projectId);
    return saved.imageModel ?? IMAGE_MODELS[0];
  });
  const [aspectRatio, setAspectRatio] = useState<string>(() => {
    if (typeof window === "undefined") return "16:9";
    const saved = loadStoryboardState(projectId);
    return saved.aspectRatio ?? "16:9";
  });
  const [scale, setScale] = useState<string>(() => {
    if (typeof window === "undefined") return "1x";
    const saved = loadStoryboardState(projectId);
    return saved.scale ?? "1x";
  });
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Ensure we always pick up the latest state when this tab is opened/mounted.
    const saved = loadStoryboardState(projectId);
    setPanels(saved.panels?.length ? saved.panels.map(persistedToPanel) : [{ ...defaultPanel }]);
    setImageModel(saved.imageModel ?? IMAGE_MODELS[0]);
    setAspectRatio(saved.aspectRatio ?? "16:9");
    setScale(saved.scale ?? "1x");
  }, [projectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string; refreshStoryboardUi?: boolean }>).detail;
      if (!detail || detail.projectId !== projectId) return;
      if (detail.refreshStoryboardUi === false) return;
      const saved = loadStoryboardState(projectId);
      setPanels(saved.panels?.length ? saved.panels.map(persistedToPanel) : [{ ...defaultPanel }]);
      setImageModel(saved.imageModel ?? IMAGE_MODELS[0]);
      setAspectRatio(saved.aspectRatio ?? "16:9");
      setScale(saved.scale ?? "1x");
    };
    window.addEventListener(STORYBOARD_STATE_CHANGED_EVENT, onChanged as EventListener);
    return () => {
      window.removeEventListener(STORYBOARD_STATE_CHANGED_EVENT, onChanged as EventListener);
    };
  }, [projectId]);

  useEffect(() => {
    textareaRefs.current.forEach(resizeTextarea);
  }, [panels]);

  useEffect(() => {
    saveStoryboardState(projectId, {
      imageModel,
      aspectRatio,
      scale,
      panels: panels.map(panelToPersisted),
    });
    const t = window.setTimeout(
      () => notifyStoryboardStateChanged(projectId, { refreshStoryboardUi: false }),
      200
    );
    return () => window.clearTimeout(t);
  }, [projectId, panels, imageModel, aspectRatio, scale]);

  function updatePanel(index: number, updates: Partial<PanelItem>) {
    if (updates.imageUrl !== undefined) {
      const key = `storyboard[${index}]`;
      if (updates.imageUrl) {
        addData(projectId, key, updates.imageUrl);
      } else {
        removeData(projectId, key);
      }
    }
    setPanels((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }

  function addPanel() {
    setPanels((prev) => [...prev, { ...defaultPanel }]);
  }

  function movePanel(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setPanels((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  }

  function removePanel(index: number) {
    setPanels((prev) => {
      const panel = prev[index];
      panel.referenceImages.forEach((r) => {
        if (r.url.startsWith("blob:")) URL.revokeObjectURL(r.url);
      });
      if (panel.imageUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(panel.imageUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewImageInputRef = useRef<HTMLInputElement>(null);
  const [attachPanelIndex, setAttachPanelIndex] = useState<number | null>(null);
  const [previewUploadPanelIndex, setPreviewUploadPanelIndex] = useState<number | null>(null);
  const [focusedPromptIndex, setFocusedPromptIndex] = useState<number | null>(null);
  const [selectPanelIndex, setSelectPanelIndex] = useState<number | null>(null);
  const [projectImages, setProjectImages] = useState<string[]>([]);
  const [attachMenuPanelIndex, setAttachMenuPanelIndex] = useState<number | null>(null);
  const [attachRefSelectImages, setAttachRefSelectImages] = useState<string[]>([]);
  const [attachRefSelectMode, setAttachRefSelectMode] = useState(false);
  const attachButtonRef = useRef<HTMLButtonElement | null>(null);
  const [attachMenuRect, setAttachMenuRect] = useState<{ top: number; left: number } | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const commandKey = `guerrilla-studio:storyboardingCommand:${projectId}`;
    const runningKey = `guerrilla-studio:storyboardingRunAllRunning:${projectId}`;
    let running = false;

    const runFromCommand = async () => {
      if (running) return;
      const raw = localStorage.getItem(commandKey);
      if (!raw) return;
      let cmd: { type?: string; ts?: number } | null = null;
      try {
        cmd = JSON.parse(raw) as { type?: string; ts?: number };
      } catch {
        cmd = null;
      }
      if (!cmd || cmd.type !== "runAll") return;

      // consume command
      localStorage.removeItem(commandKey);

      running = true;
      localStorage.setItem(runningKey, "1");
      try {
        // 1) Clear
        const all = getAll(projectId);
        Object.keys(all)
          .filter((k) => k.startsWith("storyboard"))
          .forEach((k) => removeData(projectId, k));
        setPanels([]);

        // allow state to flush
        await new Promise((r) => setTimeout(r, 0));

        // 2) Import Scenes (same logic as button)
        let scenesRaw: unknown = getData(projectId, "scenes");
        if (!Array.isArray(scenesRaw)) {
          scenesRaw = JSON.parse(String(scenesRaw ?? "null")) as unknown;
          if (!Array.isArray(scenesRaw)) {
            alert('No scenes found. Save a list as data.scenes first.');
            return;
          }
        }
        // Densify in case data.scenes is a sparse array (holes cause undefined panels).
        const scenesArr = Array.from(scenesRaw as unknown[]);
        const newPanels: PanelItem[] = await Promise.all(
          scenesArr.map(async (scene: unknown) => {
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
            const referenceDataKeys = extractSceneReferenceDataKeys(sceneObj);
            return {
              ...defaultPanel,
              promptImage: imageGenerationPrompt || prompt,
              promptVideo: "",
              referenceDataKeys,
            };
          })
        );
        if (newPanels.length === 0) {
          alert("data.scenes is empty.");
          return;
        }
        setPanels(newPanels);

        // allow panels state/ref to flush before generation loop
        await new Promise((r) => setTimeout(r, 0));

        // 3) Generate All (use the existing handler, which uses current state)
        await handleGenerateAll();
      } finally {
        running = false;
        localStorage.removeItem(runningKey);
      }
    };

    runFromCommand();

    const onStorage = (e: StorageEvent) => {
      if (e.key === commandKey) runFromCommand();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [projectId]);

  async function handleDownloadAll() {
    const urls = panels
      .map((p) => p.imageUrl)
      .filter((url): url is string => Boolean(url));
    if (urls.length === 0) {
      alert("No panel images to download.");
      return;
    }
    setDownloadingAll(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(projectId);
      if (!folder) throw new Error("Could not create zip folder");
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const fullUrl = url.startsWith("/") ? `${window.location.origin}${url}` : url;
        const res = await fetch(fullUrl);
        if (!res.ok) continue;
        const blob = await res.blob();
        const ext = url.split(".").pop()?.toLowerCase() || "png";
        folder.file(`panel-${i}.${ext}`, blob);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${projectId}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloadingAll(false);
    }
  }

  useLayoutEffect(() => {
    if (attachMenuPanelIndex === null) {
      setAttachMenuRect(null);
      return;
    }
    const el = attachButtonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAttachMenuRect({ top: rect.bottom + 4, left: rect.left });
  }, [attachMenuPanelIndex, attachRefSelectMode]);

  async function openSelectForPanel(panelIndex: number) {
    setSelectPanelIndex(panelIndex);
    try {
      const res = await fetch(
        `/api/list-project-images?projectId=${encodeURIComponent(projectId)}`
      );
      const data = await res.json();
      setProjectImages(Array.isArray(data.images) ? data.images : []);
    } catch {
      setProjectImages([]);
    }
  }

  async function openAttachRefSelect(panelIndex: number) {
    setAttachRefSelectMode(true);
    try {
      const res = await fetch(
        `/api/list-project-images?projectId=${encodeURIComponent(projectId)}`
      );
      const data = await res.json();
      setAttachRefSelectImages(Array.isArray(data.images) ? data.images : []);
    } catch {
      setAttachRefSelectImages([]);
    }
  }

  function addRefImageFromProject(panelIndex: number, url: string) {
    setPanels((prev) => {
      const next = [...prev];
      next[panelIndex] = {
        ...next[panelIndex],
        referenceImages: [...next[panelIndex].referenceImages, { url }],
      };
      return next;
    });
    setAttachMenuPanelIndex(null);
    setAttachRefSelectMode(false);
  }

  async function handleRefImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length || attachPanelIndex == null) return;
    const panelIndex = attachPanelIndex;
    const fileName = `upload-${panelIndex}-${Date.now()}`;
    setAttachPanelIndex(null);
    setAttachMenuPanelIndex(null);
    const newRefs: RefImage[] = [];
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("file", file);
      form.set("projectId", projectId);
      form.set("fileName", fileName);
      const res = await fetch("/api/upload-attachment", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error ?? "Upload failed");
        continue;
      }
      newRefs.push({ url: normalizePublicAssetUrl(data.filePath) ?? data.filePath });
    }
    if (newRefs.length > 0) {
      setPanels((prev) => {
        const next = [...prev];
        next[panelIndex] = {
          ...next[panelIndex],
          referenceImages: [...next[panelIndex].referenceImages, ...newRefs],
        };
        return next;
      });
    }
    e.target.value = "";
  }

  async function handlePreviewImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || previewUploadPanelIndex == null) return;
    const panelIndex = previewUploadPanelIndex;
    const fileName = `upload-${panelIndex}-${Date.now()}`;
    setPreviewUploadPanelIndex(null);
    const form = new FormData();
    form.set("file", file);
    form.set("projectId", projectId);
    form.set("fileName", fileName);
    try {
      const res = await fetch("/api/upload-attachment", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error ?? "Upload failed");
        return;
      }
      updatePanel(panelIndex, { imageUrl: normalizePublicAssetUrl(data.filePath) });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    }
    e.target.value = "";
  }

  function removeRefImage(panelIndex: number, refIndex: number) {
    setPanels((prev) => {
      const next = [...prev];
      const refs = next[panelIndex].referenceImages;
      const url = refs[refIndex].url;
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      next[panelIndex] = {
        ...next[panelIndex],
        referenceImages: refs.filter((_, i) => i !== refIndex),
      };
      return next;
    });
  }

  async function resolveDataReferenceToUrl(dataKey: string): Promise<string | null> {
    const pathValue = getData(projectId, dataKey);
    if (typeof pathValue !== "string" || !pathValue.trim()) return null;
    let url = pathValue.trim();
    if (url.startsWith("file://")) {
      try {
        const res = await fetch("/api/upload-from-path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, filePath: url }),
        });
        const data = await res.json();
        if (res.ok && typeof data?.filePath === "string") {
          url = data.filePath;
          // Persist converted path so this data key becomes previewable in future renders.
          addData(projectId, dataKey, url);
        } else {
          return null;
        }
      } catch {
        return null;
      }
    }
    return normalizePublicAssetUrl(url) ?? url;
  }

  async function getAttachedImagesForPanel(
    panel: PanelItem
  ): Promise<{ fileName: string; base64: string }[] | undefined> {
    const fromUrls = panel.referenceImages.map((r) => r.url);
    const fromDataKeys = await Promise.all(panel.referenceDataKeys.map(resolveDataReferenceToUrl));
    const resolvedDataUrls = fromDataKeys.filter((u): u is string => Boolean(u));
    const urls = [...fromUrls, ...resolvedDataUrls];
    if (urls.length === 0) return undefined;
    return Promise.all(
      urls.map(async (url, i) => ({
        fileName: `ref-${i}.png`,
        base64: await fetchUrlAsBase64(url),
      }))
    );
  }

  async function handleGenerateImage(panelIndex: number) {
    const currentPanels = panelsRef.current;
    const panel = currentPanels[panelIndex];
    if (!panel) {
      console.log("[Storyboarding] generate panel skip (missing panel)", { projectId, panelIndex });
      return;
    }
    if (panel.mode !== "image") {
      console.log("[Storyboarding] generate panel skip (not image mode)", { projectId, panelIndex, mode: panel.mode });
      return;
    }
    if (!panel.promptImage.trim()) {
      console.log("[Storyboarding] generate panel skip (empty prompt)", { projectId, panelIndex });
      return;
    }
    if (panel.generating) {
      console.log("[Storyboarding] generate panel skip (already generating)", { projectId, panelIndex });
      return;
    }
    const promptTrimmed = panel.promptImage.trim();
    if (promptTrimmed.toLowerCase().startsWith("search: ")) {
      searchImage(promptTrimmed.slice("search: ".length));
      return;
    }
    const sourceNumeric = /^\d+$/.test(promptTrimmed) ? parseInt(promptTrimmed, 10) : -1;
    if (sourceNumeric >= 0) {
      const scenesArr = getScenesArrayFromProject(projectId);
      const resolved = resolvePanelIndexFromNumericPrompt(
        sourceNumeric,
        currentPanels.length,
        scenesArr
      );
      let srcUrl: string | null =
        resolved >= 0 ? (currentPanels[resolved]?.imageUrl ?? null) : null;
      if (!srcUrl && resolved >= 0) {
        const fromData = getData(projectId, `storyboard[${resolved}]`);
        if (typeof fromData === "string" && fromData.trim()) {
          srcUrl = fromData.trim();
        }
      }
      if (resolved >= 0 && srcUrl) {
        updatePanel(panelIndex, {
          imageUrl: normalizePublicAssetUrl(srcUrl) ?? srcUrl,
        });
        return;
      }
      if (resolved >= 0) {
        alert(
          `Referenced scene/panel "${promptTrimmed}" has no image yet. Generate that panel first.`
        );
        return;
      }
      alert(`No scene or panel matches image prompt "${promptTrimmed}".`);
      return;
    }
    console.log(
      "[Storyboarding] generate panel start",
      { projectId, panelIndex, prompt: promptTrimmed.slice(0, 140) }
    );
    updatePanel(panelIndex, { generating: true });
    try {
      const attachedImages = await getAttachedImagesForPanel(panel);
      const fileName = `panel-${panelIndex}`;
      const imagePath = await generateImage(
        promptTrimmed,
        projectId,
        fileName,
        aspectRatio,
        attachedImages,
        imageModel
      );
      updatePanel(panelIndex, { imageUrl: imagePath, generating: false });
      console.log(
        "[Storyboarding] generate panel done",
        { projectId, panelIndex, imagePath }
      );
    } catch (err) {
      updatePanel(panelIndex, { generating: false });
      console.log(
        "[Storyboarding] generate panel error",
        { projectId, panelIndex, error: err instanceof Error ? err.message : err }
      );
      alert(err instanceof Error ? err.message : "Failed to generate image");
    }
  }

  async function handleGenerateAll() {
    for (let i = 0; i < panelsRef.current.length; i++) {
      const panel = panelsRef.current[i];
      const fromState =
        panel?.imageUrl != null &&
        typeof panel.imageUrl === "string" &&
        panel.imageUrl.trim() !== "";
      const fromDataRaw = getData(projectId, `storyboard[${i}]`);
      const fromDataStr = typeof fromDataRaw === "string" ? fromDataRaw : "";
      const fromData = fromDataStr.trim() !== "";
      if (fromState || fromData) {
        const resolvedUrl = fromState
          ? String(panel!.imageUrl).trim()
          : (normalizePublicAssetUrl(fromDataStr.trim()) ?? fromDataStr.trim());
        if (!resolvedUrl) {
          await handleGenerateImage(i);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (!fromState && fromData) {
          updatePanel(i, { imageUrl: resolvedUrl });
        } else {
          addData(projectId, `storyboard[${i}]`, resolvedUrl);
        }
        console.log("[Storyboarding] generate all skip (already has image)", {
          projectId,
          panelIndex: i,
        });
        continue;
      }
      await handleGenerateImage(i);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background text-foreground">
      {/* Top menu: Model, Aspect ratio, Scale */}
      <div className="flex flex-wrap items-center gap-4 border-b border-foreground/10 bg-foreground/5 px-6 py-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-foreground/60">Model</label>
          <select
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value)}
            className="rounded border border-foreground/20 bg-transparent px-3 py-1.5 text-sm"
          >
            {IMAGE_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-foreground/60">Aspect ratio</label>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className="rounded border border-foreground/20 bg-transparent px-3 py-1.5 text-sm"
          >
            {ASPECT_RATIOS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-foreground/60">Scale</label>
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value)}
            className="rounded border border-foreground/20 bg-transparent px-3 py-1.5 text-sm"
          >
            {SCALES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setImportModalOpen(true)}
          className="rounded border border-foreground/20 bg-transparent px-3 py-1.5 text-sm hover:bg-foreground/10"
        >
          Import
        </button>
        <button
          type="button"
          onClick={async () => {
            let raw = getData(projectId, "scenes");
            if (!Array.isArray(raw)) {
              raw = JSON.parse(String(raw ?? "null")) as unknown;
              if (!Array.isArray(raw)) {
                alert('No scenes found. Save a list as data.scenes first.');
                return;
              }
            }
            const newPanels: PanelItem[] = await Promise.all(
              raw.map(async (scene) => {
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
                const referenceDataKeys = extractSceneReferenceDataKeys(sceneObj);
                return {
                  ...defaultPanel,
                  promptImage: imageGenerationPrompt || prompt,
                  promptVideo: "",
                  referenceDataKeys,
                };
              })
            );
            if (newPanels.length === 0) {
              alert("data.scenes is empty.");
              return;
            }
            setPanels(newPanels);
          }}
          className="rounded border border-foreground/20 bg-transparent px-3 py-1.5 text-sm hover:bg-foreground/10"
        >
          Import Scenes
        </button>
        <button
          type="button"
          onClick={() => {
            if (panels.length === 0) return;
            if (typeof window !== "undefined" && !window.confirm("Remove all storyboard panels?")) return;
            clearStoryboardAll(projectId);
            setPanels([]);
          }}
          className="rounded border border-foreground/20 bg-transparent px-3 py-1.5 text-sm hover:bg-foreground/10"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleGenerateAll}
          disabled={panels.length === 0 || panels.some((p) => p.generating)}
          className="rounded border border-foreground/20 bg-transparent px-3 py-1.5 text-sm hover:bg-foreground/10 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Generate All
        </button>
        <button
          type="button"
          onClick={async () => {
            let raw = getData(projectId, "scenes");
            if (!Array.isArray(raw)) {
              try {
                raw = JSON.parse(String(raw ?? "null")) as unknown;
              } catch {
                raw = null;
              }
              if (!Array.isArray(raw)) {
                alert("No scenes found. Save a list as data.scenes first.");
                return;
              }
            }
            const text = getCopyVideoGenPromptsForGrokClipboardText(projectId);
            if (!text.trim()) {
              alert("No video generation prompts found in data.scenes.");
              return;
            }
            try {
              if (navigator.clipboard && "writeText" in navigator.clipboard) {
                await navigator.clipboard.writeText(text);
              } else {
                const textarea = document.createElement("textarea");
                textarea.value = text;
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                document.body.removeChild(textarea);
              }
            } catch (err) {
              alert(
                err instanceof Error
                  ? `Failed to copy prompts: ${err.message}`
                  : "Failed to copy prompts"
              );
            }
          }}
          className="rounded border border-foreground/20 bg-transparent px-3 py-1.5 text-xs sm:text-sm hover:bg-foreground/10"
        >
          Copy Video Gen Prompts for Grok
        </button>
        <button
          type="button"
          onClick={handleDownloadAll}
          disabled={downloadingAll || panels.every((p) => !p.imageUrl)}
          className="rounded border border-foreground/20 bg-transparent px-3 py-1.5 text-sm hover:bg-foreground/10 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloadingAll ? "Downloading…" : "Download All"}
        </button>
      </div>
      {/* Import modal */}
      {importModalOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/40 p-4"
          onClick={() => {
            setImportModalOpen(false);
            setImportText("");
          }}
        >
          <div
            className="flex h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-foreground/20 bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-modal-title"
          >
            <div className="border-b border-foreground/10 px-4 py-3">
              <h2 id="import-modal-title" className="text-sm font-medium">Import panels</h2>
              <p className="mt-0.5 text-xs text-foreground/60">One sentence per line. Each line becomes a storyboard panel.</p>
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Enter one prompt per line..."
              className="min-h-0 flex-1 resize-none border-0 border-b border-foreground/10 bg-transparent p-4 text-sm outline-none focus:ring-0"
              autoFocus
            />
            <div className="flex justify-end gap-2 border-t border-foreground/10 p-4">
              <button
                type="button"
                onClick={() => {
                  setImportModalOpen(false);
                  setImportText("");
                }}
                className="rounded border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!importText.trim()}
                onClick={() => {
                  const lines = importText
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (lines.length === 0) return;
                  const newPanels: PanelItem[] = lines.map((line) => ({
                    ...defaultPanel,
                    promptImage: line,
                    promptVideo: "",
                  }));
                  setPanels((prev) => [...prev, ...newPanels]);
                  setImportModalOpen(false);
                  setImportText("");
                }}
                className="rounded bg-accent px-3 py-1.5 text-sm text-background disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:opacity-90"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex-1 p-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleRefImages}
      />
      <input
        ref={previewImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePreviewImage}
      />
      {attachMenuPanelIndex !== null &&
        attachMenuRect &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100]"
              aria-hidden
              onClick={() => {
                setAttachMenuPanelIndex(null);
                setAttachRefSelectMode(false);
              }}
            />
            <div
              className="fixed z-[101] min-w-[140px] rounded border border-foreground/20 bg-background py-1 shadow-lg"
              style={{ top: attachMenuRect.top, left: attachMenuRect.left }}
            >
              {!attachRefSelectMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachPanelIndex(attachMenuPanelIndex);
                      fileInputRef.current?.click();
                      setAttachMenuPanelIndex(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-foreground/10"
                  >
                    Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => openAttachRefSelect(attachMenuPanelIndex)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-foreground/10"
                  >
                    Select
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setAttachRefSelectMode(false)}
                    className="border-b border-foreground/10 px-3 py-1.5 text-left text-xs text-foreground/60 hover:bg-foreground/10"
                  >
                    ← Back
                  </button>
                  <div className="max-h-48 overflow-auto py-1">
                    {attachRefSelectImages.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-foreground/60">No images in project</p>
                    ) : (
                      attachRefSelectImages.map((path) => (
                        <button
                          key={path}
                          type="button"
                          onClick={() => addRefImageFromProject(attachMenuPanelIndex, path)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-foreground/10"
                        >
                          <img src={path} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                          <span className="truncate text-foreground/80">{path.split("/").pop()}</span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </>,
          document.body
        )}
      <div className="grid grid-cols-3 gap-6">
        {panels.map((panel, index) => (
          <div
            key={index}
            className="relative flex flex-col gap-3 rounded-lg p-4"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData("text/plain"));
              if (!Number.isNaN(from)) movePanel(from, index);
            }}
          >
            {/* Preview: image area with floating prompt (fixed height so container does not grow) */}
            <div className="relative flex h-[300px] flex-col overflow-hidden rounded-lg border border-foreground/10 bg-foreground/5">
              {/* Top bar: drag handle, mode toggles; right = ref images, attach, generate, delete */}
              <div className="absolute left-2 right-2 top-2 z-10 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(index));
                    }}
                    className="cursor-grab rounded p-1.5 text-foreground/50 active:cursor-grabbing hover:bg-foreground/10 hover:text-foreground"
                    title="Drag to reorder"
                    role="button"
                    tabIndex={0}
                    aria-label="Drag to reorder panel"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="5" r="1" />
                      <circle cx="9" cy="12" r="1" />
                      <circle cx="9" cy="19" r="1" />
                      <circle cx="15" cy="5" r="1" />
                      <circle cx="15" cy="12" r="1" />
                      <circle cx="15" cy="19" r="1" />
                    </svg>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePanel(index)}
                    className="rounded p-1.5 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
                    title="Remove panel"
                    aria-label="Remove panel"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePanel(index, { mode: "image" })}
                    className={`rounded p-1.5 transition ${
                      panel.mode === "image"
                        ? "bg-accent text-background"
                        : "bg-foreground/10 text-foreground/60 hover:bg-foreground/20 hover:text-foreground/80"
                    }`}
                    title="Image mode"
                    aria-label="Image mode"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePanel(index, { mode: "video" })}
                    className={`rounded p-1.5 transition ${
                      panel.mode === "video"
                        ? "bg-accent text-background"
                        : "bg-foreground/10 text-foreground/60 hover:bg-foreground/20 hover:text-foreground/80"
                    }`}
                    title="Video mode"
                    aria-label="Video mode"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect width="15" height="14" x="1" y="5" rx="2" ry="2" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  {panel.mode === "image" && (
                    <>
                      {(panel.referenceImages.length > 0 || panel.referenceDataKeys.length > 0) && (
                        <div className="flex items-center gap-0.5">
                          {panel.referenceImages.map((ref, refIndex) => (
                            <div key={refIndex} className="relative">
                              <img src={ref.url} alt="" className="h-7 w-7 rounded object-cover" />
                              <button
                                type="button"
                                onClick={() => removeRefImage(index, refIndex)}
                                className="absolute -right-0.5 -top-0.5 rounded-full bg-foreground/80 p-0.5 text-background hover:bg-foreground"
                                title="Remove"
                                aria-label="Remove reference image"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                          {panel.referenceDataKeys.map((dataKey, keyIndex) => {
                            const raw = getData(projectId, dataKey);
                            const hasValue = typeof raw === "string" && raw.trim() !== "";
                            const value = hasValue ? raw.trim() : "";
                            const canPreview = hasValue && !value.startsWith("file://");
                            const previewUrl = canPreview ? (normalizePublicAssetUrl(value) ?? value) : null;
                            return (
                              <div
                                key={`data-ref-${keyIndex}-${dataKey}`}
                                className="relative"
                                title={previewUrl ? `data.${dataKey}` : `data.${dataKey} (missing)`}
                              >
                                {previewUrl ? (
                                  <img src={previewUrl} alt="" className="h-7 w-7 rounded object-cover ring-1 ring-accent/30" />
                                ) : (
                                  <div className="flex h-7 w-7 items-center justify-center rounded bg-foreground/10 text-xs font-semibold text-foreground/70 ring-1 ring-foreground/20">
                                    ?
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="relative">
                        <button
                          ref={attachMenuPanelIndex === index ? attachButtonRef : null}
                          type="button"
                          onClick={() => {
                            if (attachMenuPanelIndex === index) {
                              setAttachMenuPanelIndex(null);
                              setAttachRefSelectMode(false);
                            } else {
                              setAttachRefSelectMode(false);
                              setAttachMenuPanelIndex(index);
                            }
                          }}
                          className="rounded p-1.5 text-foreground/60 transition hover:bg-foreground/10 hover:text-foreground"
                          title="Attach reference images"
                          aria-label="Attach reference images"
                          aria-expanded={attachMenuPanelIndex === index}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                            <circle cx="9" cy="9" r="2" />
                            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                  <div className="flex items-center rounded border border-foreground/20 bg-foreground/5 overflow-hidden">
                    <button
                      type="button"
                      disabled={
                        (panel.mode === "image" ? !panel.promptImage.trim() : !panel.promptVideo.trim()) ||
                        panel.generating
                      }
                      onClick={() => {
                        if (panel.mode === "image") {
                          handleGenerateImage(index);
                        } else {
                          // TODO: wire to video generation API
                        }
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-foreground/80 transition hover:bg-foreground/10 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                      title={panel.mode === "image" ? "Generate Image" : "Generate Video"}
                      aria-label={panel.mode === "image" ? "Generate Image" : "Generate Video"}
                    >
                      {panel.generating ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground" />
                      ) : (
                        "Generate"
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
                {panel.imageUrl ? (
                  <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden">
                    <img
                      src={panel.imageUrl}
                      alt={`Panel ${index + 1}`}
                      className="max-h-full max-w-full object-contain"
                    />
                    {panel.mode === "image" && (
                      <></>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewUploadPanelIndex(index);
                          previewImageInputRef.current?.click();
                        }}
                        className="flex flex-col items-center gap-2 rounded border border-dashed border-foreground/30 px-4 py-3 text-foreground/60 transition hover:border-foreground/50 hover:bg-foreground/5 hover:text-foreground/80"
                        title="Upload image"
                        aria-label="Upload image to preview"
                      >
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" x2="12" y1="3" y2="15" />
                        </svg>
                        <span className="text-sm">Upload image</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openSelectForPanel(index)}
                        className="flex flex-col items-center gap-2 rounded border border-dashed border-foreground/30 px-4 py-3 text-foreground/60 transition hover:border-foreground/50 hover:bg-foreground/5 hover:text-foreground/80"
                        title="Select from project images"
                        aria-label="Select from project images"
                      >
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                          <circle cx="9" cy="9" r="2" />
                          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                        </svg>
                        <span className="text-sm">Select</span>
                      </button>
                    </div>
                  </div>
                )}
                {panel.mode === "image" && selectPanelIndex === index && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      aria-hidden
                      onClick={() => setSelectPanelIndex(null)}
                    />
                    <div className="absolute bottom-14 left-1/2 z-30 max-h-48 w-full max-w-xs -translate-x-1/2 overflow-auto rounded border border-foreground/20 bg-background py-1 shadow-lg">
                      {projectImages.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-foreground/60">No images in project</p>
                      ) : (
                        <ul className="py-1">
                          {projectImages.map((path) => (
                            <li key={path}>
                              <button
                                type="button"
                                onClick={() => {
                                  updatePanel(index, { imageUrl: path });
                                  setSelectPanelIndex(null);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-foreground/10"
                              >
                                <img
                                  src={path}
                                  alt=""
                                  className="h-8 w-8 shrink-0 rounded object-cover"
                                />
                                <span className="truncate text-foreground/80">{path.split("/").pop()}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Floating prompt: separate inputs for image vs video mode; single line + ellipsis when not focused */}
              <div className="absolute bottom-0 left-0 right-0 z-10 flex items-end p-2">
                <div className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-end">
                  {panel.mode === "image" ? (
                    <div className="flex items-center justify-center">
                      <textarea
                        ref={(el) => {
                          textareaRefs.current[index] = el;
                        }}
                        value={panel.promptImage}
                        onChange={(e) => updatePanel(index, { promptImage: e.target.value })}
                        onFocus={() => setFocusedPromptIndex(index)}
                        onBlur={() => setFocusedPromptIndex(null)}
                        placeholder="Image generation prompt"
                        className={`w-full resize-none border-0 px-1 py-1 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0 text-center bg-transparent ${
                          focusedPromptIndex === index
                            ? "min-h-[44px] overflow-hidden"
                            : "h-6 max-h-6 overflow-hidden text-ellipsis whitespace-nowrap"
                        }`}
                        rows={focusedPromptIndex === index ? 1 : 1}
                      />
                      {panel.imageUrl ? (
                        <button
                          type="button"
                          onClick={() => updatePanel(index, { imageUrl: null })}
                          className="right-1.5 bottom-1.5 rounded-full bg-foreground/80 p-1.5 text-background transition hover:bg-foreground"
                          title="Remove image"
                          aria-label="Remove image"
                        >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                        </button>                      
                      ) : null}
                    </div>
                  ) : (
                    <textarea
                      ref={(el) => {
                        textareaRefs.current[index] = el;
                      }}
                      value={panel.promptVideo}
                      onChange={(e) => updatePanel(index, { promptVideo: e.target.value })}
                      onFocus={() => setFocusedPromptIndex(index)}
                      onBlur={() => setFocusedPromptIndex(null)}
                      placeholder="Video generation prompt"
                      className={`w-full resize-none border-0 px-0 py-1 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0 text-center bg-transparent ${
                        focusedPromptIndex === index
                          ? "min-h-[44px] overflow-hidden"
                          : "h-6 max-h-6 overflow-hidden text-ellipsis whitespace-nowrap"
                      }`}
                      rows={focusedPromptIndex === index ? 1 : 1}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <button
          type="button"
          onClick={addPanel}
          className="rounded border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/60 hover:border-foreground/40 hover:text-foreground/80"
        >
          + Add panel
        </button>
      </div>
      </div>
    </div>
  );
}
