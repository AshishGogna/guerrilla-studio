"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import { useNodesContext } from "./NodesContext";
import { getData } from "@/lib/data";
import { getScenesArrayFromProject } from "@/lib/storyboardNumericPrompt";
import { runStoryboardDownloadAndCopy } from "@/lib/storyboardDownloadCopy";
import { loadStoryboardState, saveStoryboardState } from "@/lib/state-storage";

const IMAGE_MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"] as const;
type ImageModel = (typeof IMAGE_MODELS)[number];

const ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;
type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type NodeStoryboardData = BaseNodeData & {
  imageModel?: ImageModel;
  /** Persisted on node + synced to storyboard state for generation */
  aspectRatio?: string;
  fromScene?: string;
  toScene?: string;
  /** Bumped by canvas when chain-play presets range — refreshes scene count label (not persisted). */
  chainSyncNonce?: number;
};

function defaultToSceneIndex(projectId: string): string {
  const scenesLen = getScenesArrayFromProject(projectId).length;
  const panelLen = loadStoryboardState(projectId).panels.length;
  return String(Math.max(0, Math.max(panelLen, scenesLen) - 1));
}

export default function NodeStoryboard(props: NodeProps<NodeStoryboardData>) {
  const { id, data } = props;
  const { projectId } = useNodesContext();
  const rf = useReactFlow();

  const [imageModel, setImageModel] = useState<ImageModel>(() => {
    if (data.imageModel && IMAGE_MODELS.includes(data.imageModel)) return data.imageModel;
    const m = loadStoryboardState(projectId).imageModel;
    if (IMAGE_MODELS.includes(m as ImageModel)) return m as ImageModel;
    return IMAGE_MODELS[0];
  });
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(() => {
    if (data.aspectRatio && ASPECT_RATIOS.includes(data.aspectRatio as AspectRatio)) {
      return data.aspectRatio as AspectRatio;
    }
    const ar = loadStoryboardState(projectId).aspectRatio;
    if (ASPECT_RATIOS.includes(ar as AspectRatio)) return ar as AspectRatio;
    return "16:9";
  });
  const [fromScene, setFromScene] = useState(() => data.fromScene ?? "0");
  const [toScene, setToScene] = useState(() => data.toScene ?? defaultToSceneIndex(projectId));
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
  }, [projectId, data.chainSyncNonce]);

  const maxSceneIndex = useMemo(() => {
    const story = loadStoryboardState(projectId);
    return Math.max(0, Math.max(story.panels.length, scenesCount) - 1);
  }, [projectId, scenesCount]);

  /** Re-hydrate from persisted node data (e.g. after nodes.json load). */
  useEffect(() => {
    if (data.aspectRatio && ASPECT_RATIOS.includes(data.aspectRatio as AspectRatio)) {
      setAspectRatio(data.aspectRatio as AspectRatio);
    }
    if (data.imageModel && IMAGE_MODELS.includes(data.imageModel)) {
      setImageModel(data.imageModel);
    }
    if (typeof data.fromScene === "string") setFromScene(data.fromScene);
    if (typeof data.toScene === "string") setToScene(data.toScene);
  }, [
    data.aspectRatio,
    data.imageModel,
    data.fromScene,
    data.toScene,
    id,
  ]);

  const patchNodeData = useCallback(
    (patch: Partial<NodeStoryboardData>) => {
      rf.setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...(n.data as object), ...patch } } : n
        )
      );
    },
    [id, rf]
  );

  useEffect(() => {
    const n = parseInt(toScene, 10);
    if (Number.isNaN(n) || n > maxSceneIndex) {
      const next = String(maxSceneIndex);
      setToScene(next);
      patchNodeData({ toScene: next });
    }
  }, [maxSceneIndex, patchNodeData, toScene]);

  const persistStoryboardField = useCallback(
    (patch: Partial<{ aspectRatio: string; imageModel: string }>) => {
      const prev = loadStoryboardState(projectId);
      saveStoryboardState(projectId, { ...prev, ...patch });
    },
    [projectId]
  );

  const handleDownloadAndCopy = useCallback(async () => {
    let from = parseInt(fromScene, 10);
    let to = parseInt(toScene, 10);
    if (Number.isNaN(from)) from = 0;
    if (Number.isNaN(to)) to = 0;

    setDownloadBusy(true);
    try {
      await runStoryboardDownloadAndCopy(projectId, from, to);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download & copy failed");
    } finally {
      setDownloadBusy(false);
    }
  }, [fromScene, projectId, toScene]);

  return (
    <BaseNode {...props} className="min-w-[360px]">
      <div className="text-sm text-foreground/80">Total scenes: {scenesCount}</div>

      <div className="mt-3">
        <label className="mb-1 block text-xs text-foreground/60">Aspect ratio</label>
        <select
          value={aspectRatio}
          onChange={(e) => {
            const v = e.target.value as AspectRatio;
            setAspectRatio(v);
            persistStoryboardField({ aspectRatio: v });
            patchNodeData({ aspectRatio: v });
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
            patchNodeData({ imageModel: v });
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
            onChange={(e) => {
              const v = e.target.value;
              setFromScene(v);
              patchNodeData({ fromScene: v });
            }}
            className="nodrag w-full rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">To scene</label>
          <input
            type="text"
            inputMode="numeric"
            value={toScene}
            onChange={(e) => {
              const v = e.target.value;
              setToScene(v);
              patchNodeData({ toScene: v });
            }}
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
