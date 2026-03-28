"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Handle, Position, type NodeProps } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import { useNodesContext } from "./NodesContext";
import { getData } from "@/lib/data";
import { getScenesArrayFromProject } from "@/lib/storyboardNumericPrompt";
import { executeStoryboardRunAll } from "@/lib/storyboardRunAll";
import { loadStoryboardState, saveStoryboardState } from "@/lib/state-storage";

const IMAGE_MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"] as const;
type ImageModel = (typeof IMAGE_MODELS)[number];

const ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;
type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type NodeStoryboardData = BaseNodeData & {
  imageModel?: ImageModel;
};

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

export default function NodeStoryboard(props: NodeProps<NodeStoryboardData>) {
  const { id } = props;
  const { projectId, setNodePlaying } = useNodesContext();
  const runLockRef = useRef(false);

  const [imageModel, setImageModel] = useState<ImageModel>(
    props.data.imageModel ?? IMAGE_MODELS[0]
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [fromScene, setFromScene] = useState("0");
  const [toScene, setToScene] = useState(() => {
    const scenesLen = getScenesArrayFromProject(projectId).length;
    const panelLen = loadStoryboardState(projectId).panels.length;
    return String(Math.max(0, Math.max(panelLen, scenesLen) - 1));
  });
  const [downloadBusy, setDownloadBusy] = useState(false);

  const scenesCount = useMemo(() => {
    const raw = getData(projectId, "scenes");
    if (Array.isArray(raw)) return raw.length;
    try {
      const parsed = JSON.parse(String(raw ?? "null")) as unknown;
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }, [projectId]);

  const maxSceneIndex = useMemo(() => {
    const story = loadStoryboardState(projectId);
    return Math.max(0, Math.max(story.panels.length, scenesCount) - 1);
  }, [projectId, scenesCount]);

  useEffect(() => {
    const s = loadStoryboardState(projectId);
    const ar = s.aspectRatio;
    if (ASPECT_RATIOS.includes(ar as AspectRatio)) {
      setAspectRatio(ar as AspectRatio);
    } else {
      setAspectRatio("16:9");
    }
    const m = s.imageModel;
    if (IMAGE_MODELS.includes(m as ImageModel)) {
      setImageModel(m as ImageModel);
    }
  }, [projectId]);

  useEffect(() => {
    setToScene((prev) => {
      const n = parseInt(prev, 10);
      if (Number.isNaN(n) || n > maxSceneIndex) return String(maxSceneIndex);
      return prev;
    });
  }, [maxSceneIndex]);

  const persistStoryboardField = useCallback(
    (patch: Partial<{ aspectRatio: string; imageModel: string }>) => {
      const prev = loadStoryboardState(projectId);
      saveStoryboardState(projectId, { ...prev, ...patch });
    },
    [projectId]
  );

  const handlePlay = useCallback(async () => {
    if (runLockRef.current) return;
    runLockRef.current = true;
    setNodePlaying(id, true);
    try {
      await executeStoryboardRunAll(projectId);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Storyboard run failed");
    } finally {
      setNodePlaying(id, false);
      runLockRef.current = false;
    }
  }, [id, projectId, setNodePlaying]);

  const handleDownloadAndCopy = useCallback(async () => {
    const scenes = getScenesArrayFromProject(projectId);
    const { panels } = loadStoryboardState(projectId);
    const last = Math.max(0, Math.max(panels.length, scenes.length) - 1);

    let from = parseInt(fromScene, 10);
    let to = parseInt(toScene, 10);
    if (Number.isNaN(from)) from = 0;
    if (Number.isNaN(to)) to = last;
    from = Math.max(0, Math.min(from, last));
    to = Math.max(0, Math.min(to, last));
    if (from > to) [from, to] = [to, from];

    setDownloadBusy(true);
    try {
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
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download & copy failed");
    } finally {
      setDownloadBusy(false);
    }
  }, [fromScene, projectId, toScene]);

  return (
    <BaseNode
      {...props}
      className="min-w-[360px] border-foreground/20"
      onPlayClick={() => {
        void handlePlay();
      }}
    >
      <div className="text-sm text-foreground/80">{`{${scenesCount} Scenes}`}</div>

      <div className="mt-3">
        <label className="mb-1 block text-xs text-foreground/60">Aspect ratio</label>
        <select
          value={aspectRatio}
          onChange={(e) => {
            const v = e.target.value as AspectRatio;
            setAspectRatio(v);
            persistStoryboardField({ aspectRatio: v });
          }}
          className="nodrag w-full rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
        >
          {ASPECT_RATIOS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs text-foreground/60">Image model</label>
        <select
          value={imageModel}
          onChange={(e) => {
            const v = e.target.value as ImageModel;
            setImageModel(v);
            persistStoryboardField({ imageModel: v });
          }}
          className="nodrag w-full rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-foreground/60">From scene</label>
          <input
            type="text"
            inputMode="numeric"
            value={fromScene}
            onChange={(e) => setFromScene(e.target.value)}
            className="nodrag w-full rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">To scene</label>
          <input
            type="text"
            inputMode="numeric"
            value={toScene}
            onChange={(e) => setToScene(e.target.value)}
            className="nodrag w-full rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="mt-3">
        <button
          type="button"
          disabled={downloadBusy}
          className="nodrag w-full rounded border border-foreground/20 bg-foreground/10 px-2 py-1.5 text-sm hover:bg-foreground/20 disabled:opacity-50"
          onClick={() => void handleDownloadAndCopy()}
        >
          {downloadBusy ? "Working…" : "Download & Copy"}
        </button>
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </BaseNode>
  );
}
