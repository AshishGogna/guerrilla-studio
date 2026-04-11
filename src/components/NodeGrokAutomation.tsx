"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import { useNodesContext } from "./NodesContext";
import { joinFilePathsForStorage } from "@/lib/agenticEditorDataSync";

const ASPECT_RATIOS = ["9:16", "16:9"] as const;
const DURATIONS = ["6s", "10s"] as const;
const RESOLUTIONS = ["480p", "720p"] as const;
const MODES = ["Frame to Video"] as const;

export type GrokAspectRatio = (typeof ASPECT_RATIOS)[number];
export type GrokDuration = (typeof DURATIONS)[number];
export type GrokResolution = (typeof RESOLUTIONS)[number];
export type GrokMode = (typeof MODES)[number];

export type NodeGrokAutomationData = BaseNodeData & {
  aspectRatio?: GrokAspectRatio;
  duration?: GrokDuration;
  resolution?: GrokResolution;
  mode?: GrokMode;
  upscale?: boolean;
  /** Newline-separated absolute or project paths after upload. */
  imagePaths?: string;
  prompts?: string;
  sessionId?: string;
  onGrokAutomationChange?: (
    nodeId: string,
    patch: Partial<
      Pick<
        NodeGrokAutomationData,
        | "aspectRatio"
        | "duration"
        | "resolution"
        | "mode"
        | "upscale"
        | "imagePaths"
        | "prompts"
        | "sessionId"
      >
    >
  ) => void;
};

function coerceAspect(v: unknown): GrokAspectRatio {
  return v === "9:16" || v === "16:9" ? v : "16:9";
}
function coerceDuration(v: unknown): GrokDuration {
  return v === "6s" || v === "10s" ? v : "6s";
}
function coerceResolution(v: unknown): GrokResolution {
  return v === "480p" || v === "720p" ? v : "720p";
}
function coerceMode(v: unknown): GrokMode {
  return v === "Frame to Video" ? v : "Frame to Video";
}

export default function NodeGrokAutomation(props: NodeProps<NodeGrokAutomationData>) {
  const { id, data } = props;
  const { projectId, selectNode } = useNodesContext();
  const [fileInputMounted, setFileInputMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const aspectRatio = coerceAspect(data.aspectRatio);
  const duration = coerceDuration(data.duration);
  const resolution = coerceResolution(data.resolution);
  const mode = coerceMode(data.mode);
  const upscale = data.upscale !== false;
  const imagePaths = data.imagePaths ?? "";
  const prompts = data.prompts ?? "";
  const sessionIdDraft = data.sessionId ?? "";

  const patch = useCallback(
    (p: Parameters<NonNullable<NodeGrokAutomationData["onGrokAutomationChange"]>>[1]) => {
      data.onGrokAutomationChange?.(id, p);
    },
    [data, id]
  );

  useEffect(() => {
    setFileInputMounted(true);
    return () => setFileInputMounted(false);
  }, []);

  const onImagesChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const list = input.files?.length ? Array.from(input.files) : [];
      input.value = "";
      if (list.length === 0) return;

      const fileObjs = list as (File & { path?: string })[];
      const hasAllAbsPaths = fileObjs.every((f) => typeof f.path === "string" && f.path.trim());
      let absPaths: string[] = [];
      if (hasAllAbsPaths) {
        absPaths = fileObjs.map((f) => String(f.path).trim());
      } else {
        try {
          const form = new FormData();
          form.set("projectId", projectId);
          list.forEach((f) => form.append("files", f));
          const res = await fetch("/api/agentic-editor-upload", { method: "POST", body: form });
          const body = (await res.json().catch(() => null)) as { absPaths?: unknown; error?: string } | null;
          if (!res.ok) throw new Error(body?.error ?? "Upload failed");
          absPaths = Array.isArray(body?.absPaths)
            ? (body!.absPaths.filter((p): p is string => typeof p === "string" && Boolean(p.trim())) as string[])
            : [];
        } catch (err) {
          console.error(err);
          alert(err instanceof Error ? err.message : "Failed to upload files");
          return;
        }
      }

      const next = joinFilePathsForStorage(imagePaths, ...absPaths);
      patch({ imagePaths: next });
    },
    [imagePaths, patch, projectId]
  );

  const pathCount = imagePaths
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean).length;

  return (
    <>
      <BaseNode {...props} className="min-w-[360px]">
        <label className="mb-1 block text-xs font-medium text-foreground/60">Aspect ratio</label>
        <select
          className="nodrag mb-3 w-full rounded border border-foreground/15 bg-foreground/[0.04] px-2 py-2 text-sm text-foreground/90 outline-none focus:border-foreground/30"
          value={aspectRatio}
          onChange={(e) => patch({ aspectRatio: e.target.value as GrokAspectRatio })}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(id, e);
          }}
        >
          {ASPECT_RATIOS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-medium text-foreground/60">Duration</label>
        <select
          className="nodrag mb-3 w-full rounded border border-foreground/15 bg-foreground/[0.04] px-2 py-2 text-sm text-foreground/90 outline-none focus:border-foreground/30"
          value={duration}
          onChange={(e) => patch({ duration: e.target.value as GrokDuration })}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(id, e);
          }}
        >
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-medium text-foreground/60">Resolution</label>
        <select
          className="nodrag mb-3 w-full rounded border border-foreground/15 bg-foreground/[0.04] px-2 py-2 text-sm text-foreground/90 outline-none focus:border-foreground/30"
          value={resolution}
          onChange={(e) => patch({ resolution: e.target.value as GrokResolution })}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(id, e);
          }}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-medium text-foreground/60">Mode</label>
        <select
          className="nodrag mb-3 w-full rounded border border-foreground/15 bg-foreground/[0.04] px-2 py-2 text-sm text-foreground/90 outline-none focus:border-foreground/30"
          value={mode}
          onChange={(e) => patch({ mode: e.target.value as GrokMode })}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(id, e);
          }}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <label className="nodrag mb-1 flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground/60">
          <input
            type="checkbox"
            className="nodrag rounded border border-foreground/30"
            checked={upscale}
            onChange={(e) => patch({ upscale: e.target.checked })}
            onMouseDown={(e) => {
              e.stopPropagation();
              selectNode(id, e);
            }}
          />
          Upscale
        </label>

        <div className="mb-3 mt-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground/60">Images</span>
            <button
              type="button"
              className="nodrag rounded border border-foreground/25 bg-foreground/5 px-2 py-0.5 text-xs text-foreground/90 hover:bg-foreground/10"
              onMouseDown={(e) => {
                e.stopPropagation();
                selectNode(id, e);
              }}
              onClick={(e) => {
                e.stopPropagation();
                window.setTimeout(() => fileInputRef.current?.click(), 0);
              }}
            >
              Choose files…
            </button>
          </div>
          <p className="text-xs text-foreground/50">
            {pathCount === 0 ? "No images selected." : `${pathCount} path(s) stored (newline-separated).`}
          </p>
          {imagePaths.trim() ? (
            <textarea
              readOnly
              className="nowheel mt-1 max-h-24 w-full resize-y rounded border border-foreground/10 bg-foreground/[0.03] px-2 py-1 font-mono text-[11px] text-foreground/70"
              value={imagePaths}
              rows={3}
              onMouseDown={(e) => {
                e.stopPropagation();
                selectNode(id, e);
              }}
            />
          ) : null}
        </div>

        <label className="mb-1 block text-xs font-medium text-foreground/60">Prompts</label>
        <textarea
          className="nodrag nowheel mb-3 min-h-[100px] w-full resize-y rounded border border-foreground/15 bg-foreground/[0.04] px-2 py-2 text-sm text-foreground/90 outline-none focus:border-foreground/30"
          placeholder="Prompts…"
          value={prompts}
          onChange={(e) => patch({ prompts: e.target.value })}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(id, e);
          }}
        />

        <label className="mb-1 block text-xs font-medium text-foreground/60">Session id</label>
        <input
          className="nodrag mb-2 w-full rounded border border-foreground/15 bg-foreground/[0.04] px-2 py-2 text-sm text-foreground/90 outline-none focus:border-foreground/30"
          placeholder="Session id"
          value={sessionIdDraft}
          onChange={(e) => patch({ sessionId: e.target.value })}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(id, e);
          }}
        />

        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </BaseNode>
      {fileInputMounted && typeof document !== "undefined"
        ? createPortal(
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              tabIndex={-1}
              aria-hidden
              className="fixed left-0 top-0 z-[300] m-0 p-0 opacity-0"
              style={{ width: "1px", height: "1px" }}
              onChange={onImagesChange}
            />,
            document.body
          )
        : null}
    </>
  );
}
