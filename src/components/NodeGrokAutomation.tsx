"use client";

import { useCallback, useEffect, useRef } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import { useNodesContext } from "./NodesContext";
import { collectGrokAutomationFromStoryboard } from "@/lib/grokStoryboardSource";
import { STORYBOARD_STATE_CHANGED_EVENT } from "@/lib/storyboardStateEvent";

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
  /** Synced from storyboard panel image URLs (newline-separated). */
  imagePaths?: string;
  /** Synced from data.scenes video prompts (same extraction as Copy Video Gen for Grok; `\n\n` between panels). */
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

  const onGrokChangeRef = useRef(data.onGrokAutomationChange);
  onGrokChangeRef.current = data.onGrokAutomationChange;

  const pushStoryboardIntoNode = useCallback(() => {
    const c = collectGrokAutomationFromStoryboard(projectId);
    onGrokChangeRef.current?.(id, {
      imagePaths: c.imagePathsStorage,
      prompts: c.promptsStorage,
    });
  }, [projectId, id]);

  useEffect(() => {
    pushStoryboardIntoNode();
  }, [pushStoryboardIntoNode]);

  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId === projectId) pushStoryboardIntoNode();
    };
    window.addEventListener(STORYBOARD_STATE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(STORYBOARD_STATE_CHANGED_EVENT, onChanged);
  }, [projectId, pushStoryboardIntoNode]);

  const pathCount = imagePaths
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean).length;

  return (
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="nodrag rounded border border-foreground/25 bg-foreground/5 px-2 py-0.5 text-xs text-foreground/90 hover:bg-foreground/10"
              title="Reload panel image paths and video prompts from Storyboarding"
              onMouseDown={(e) => {
                e.stopPropagation();
                selectNode(id, e);
              }}
              onClick={(e) => {
                e.stopPropagation();
                pushStoryboardIntoNode();
              }}
            >
              Refresh
            </button>
            <span className="text-[10px] text-foreground/45">Storyboard</span>
          </div>
        </div>
        <p className="text-xs text-foreground/50">
          {pathCount === 0
            ? "No panel images yet — generate images in Storyboarding."
            : `${pathCount} panel image(s) (synced from Storyboarding).`}
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
      <p className="mb-1 text-[10px] text-foreground/45">
        Same video prompts as &quot;Copy Video Gen Prompts for Grok&quot; (per panel with an image).
      </p>
      <textarea
        readOnly
        className="nowheel mb-3 min-h-[100px] w-full resize-y rounded border border-foreground/15 bg-foreground/[0.03] px-2 py-2 text-sm text-foreground/80 outline-none"
        placeholder="(No prompts for current panels)"
        value={prompts}
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
  );
}
