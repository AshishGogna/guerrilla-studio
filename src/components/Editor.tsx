"use client";

import { renderMediaOnWeb } from "@remotion/web-renderer";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { AbsoluteFill, Sequence, Video, useVideoConfig } from "remotion";

const RemotionPlayer = dynamic(
  () =>
    import("@remotion/player").then((mod) => mod.Player),
  { ssr: false }
);

const FPS = 30;
const COMP_WIDTH = 1920;
const COMP_HEIGHT = 1080;

/** Ensures a value is a finite number for CSS/props. Never returns NaN. */
function toFinite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export interface EditorClip {
  id: string;
  src: string;
  trimStartSec: number;
  trimEndSec: number;
  durationSec?: number;
}

export function EditorCompositionWithProps({ clips = [] }: { clips?: EditorClip[] }) {
  const { fps } = useVideoConfig();

  if (clips.length === 0) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#111",
          justifyContent: "center",
          alignItems: "center",
          color: "#888",
          fontSize: 24,
        }}
      >
        No clips. Add clips to the timeline.
      </AbsoluteFill>
    );
  }

  const safeFps = toFinite(fps, FPS);
  let fromFrame = 0;
  return (
    <>
      {clips.map((clip) => {
        const durationSec = Math.max(
          0,
          toFinite(clip.trimEndSec, 0) - toFinite(clip.trimStartSec, 0)
        );
        const durationInFrames = Math.max(
          1,
          Math.round(toFinite(durationSec * safeFps, 0))
        );
        const trimBefore = Math.max(
          0,
          Math.round(toFinite(clip.trimStartSec, 0) * safeFps)
        );
        const durationSecClip = toFinite(clip.durationSec, 0);
        const trimAfterFrames =
          clip.durationSec != null && durationSecClip > 0
            ? Math.round(
                (durationSecClip - toFinite(clip.trimEndSec, 0)) * safeFps
              )
            : 0;
        // Remotion Video requires trimAfter to be positive when provided; omit if 0
        const trimAfter = trimAfterFrames > 0 ? trimAfterFrames : undefined;

        const seq = (
          <Sequence
            key={clip.id}
            from={toFinite(fromFrame, 0)}
            durationInFrames={durationInFrames}
            name={`Clip ${clip.id}`}
          >
            <AbsoluteFill>
              <Video
                src={clip.src}
                trimBefore={trimBefore}
                {...(trimAfter !== undefined && { trimAfter })}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </AbsoluteFill>
          </Sequence>
        );
        fromFrame += durationInFrames;
        return seq;
      })}
    </>
  );
}

export default function Editor() {
  const [clips, setClips] = useState<EditorClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalDurationSec = clips.reduce((acc, c) => {
    const d = toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0);
    return acc + Math.max(0, d);
  }, 0);
  const durationInFrames = Math.max(
    1,
    Math.ceil(toFinite(totalDurationSec * FPS, 0))
  );

  const addClip = useCallback((src: string, durationSec?: number) => {
    const id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const endSec = toFinite(durationSec, 10);
    setClips((prev) => [
      ...prev,
      {
        id,
        src,
        trimStartSec: 0,
        trimEndSec: Math.max(0, endSec),
        durationSec: Number.isFinite(Number(durationSec)) ? durationSec : undefined,
      },
    ]);
    setAddUrl("");
  }, []);

  const removeClip = useCallback((id: string) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === id);
      if (clip?.src.startsWith("blob:")) {
        URL.revokeObjectURL(clip.src);
      }
      return prev.filter((c) => c.id !== id);
    });
    if (selectedClipId === id) setSelectedClipId(null);
  }, [selectedClipId]);

  const handleUploadClips = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      for (const file of Array.from(files)) {
        const url = URL.createObjectURL(file);
        addClip(url);
      }
      e.target.value = "";
    },
    [addClip]
  );

  const updateClip = useCallback(
    (id: string, patch: Partial<EditorClip>) => {
      setClips((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      );
    },
    []
  );

  const moveClip = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setClips((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    if (clips.length === 0) {
      alert("Add at least one clip to export.");
      return;
    }
    setExporting(true);
    try {
      const safeDuration = Math.max(1, toFinite(durationInFrames, 1));
      const { getBlob } = await renderMediaOnWeb({
        composition: {
          id: "editor-composition",
          component: EditorCompositionWithProps,
          durationInFrames: safeDuration,
          fps: FPS,
          width: toFinite(COMP_WIDTH, 1920),
          height: toFinite(COMP_HEIGHT, 1080),
          defaultProps: { clips: [] },
        },
        inputProps: { clips },
      });
      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "edited-video.mp4";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [clips, durationInFrames]);

  const selectedClip = clips.find((c) => c.id === selectedClipId);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      {/* Preview */}
      <div className="flex shrink-0 justify-center border-b border-foreground/10 bg-black/40 p-4">
        <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg bg-black">
          <RemotionPlayerPreview clips={clips} durationInFrames={durationInFrames} />
        </div>
      </div>

      {/* Timeline */}
      <div className="flex flex-1 flex-col overflow-hidden border-t border-foreground/10">
        <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-2">
          <span className="text-sm font-medium text-foreground/80">Timeline</span>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={handleUploadClips}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20"
            >
              Upload clips
            </button>
            <input
              type="url"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="Or paste video URL..."
              className="w-56 rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => {
                const url = addUrl.trim();
                if (url) addClip(url);
              }}
              disabled={!addUrl.trim()}
              className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20 disabled:opacity-50"
            >
              Add from URL
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || clips.length === 0}
              className="rounded bg-accent px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? "Exporting…" : "Export"}
            </button>
          </div>
        </div>
        <div className="flex flex-1 gap-1 overflow-x-auto p-4">
          {clips.map((clip, index) => (
            <TimelineClipBlock
              key={clip.id}
              clip={clip}
              isSelected={selectedClipId === clip.id}
              isDragged={draggedId === clip.id}
              isDragOver={dragOverId === clip.id}
              onSelect={() => setSelectedClipId(clip.id)}
              onRemove={() => removeClip(clip.id)}
              onUpdate={(patch) => updateClip(clip.id, patch)}
              onDragStart={() => setDraggedId(clip.id)}
              onDragEnd={() => {
                setDraggedId(null);
                setDragOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedId !== clip.id) setDragOverId(clip.id);
              }}
              onDrop={() => {
                if (draggedId == null) return;
                const fromIndex = clips.findIndex((c) => c.id === draggedId);
                if (fromIndex !== -1) moveClip(fromIndex, index);
                setDraggedId(null);
                setDragOverId(null);
              }}
            />
          ))}
        </div>
        {selectedClip && (
          <div className="border-t border-foreground/10 px-4 py-3">
            <span className="text-xs font-medium text-foreground/60">
              Trim: {selectedClip.id}
            </span>
            <div className="mt-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                Start (s):
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, toFinite(selectedClip.trimEndSec, 10) - 0.1)}
                  step={0.1}
                  value={toFinite(selectedClip.trimStartSec, 0)}
                  onChange={(e) =>
                    updateClip(selectedClip.id, {
                      trimStartSec: Math.max(0, toFinite(e.target.value, 0)),
                    })
                  }
                  className="w-20 rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                End (s):
                <input
                  type="number"
                  min={toFinite(selectedClip.trimStartSec, 0) + 0.1}
                  max={toFinite(selectedClip.durationSec, 999) || 999}
                  step={0.1}
                  value={toFinite(selectedClip.trimEndSec, 10)}
                  onChange={(e) =>
                    updateClip(selectedClip.id, {
                      trimEndSec: Math.max(
                        toFinite(selectedClip.trimStartSec, 0),
                        toFinite(e.target.value, 10)
                      ),
                    })
                  }
                  className="w-20 rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RemotionPlayerPreview({
  clips,
  durationInFrames,
}: {
  clips: EditorClip[];
  durationInFrames: number;
}) {
  const safeDurationInFrames = Math.max(1, Math.floor(toFinite(durationInFrames, 1)));
  const compWidth = toFinite(COMP_WIDTH, 1920);
  const compHeight = toFinite(COMP_HEIGHT, 1080);
  const playerWidth = 640;
  const playerHeight = 360;
  const safeStyle: React.CSSProperties = {
    width: toFinite(playerWidth, 640),
    height: toFinite(playerHeight, 360),
    maxWidth: "100%",
    maxHeight: "100%",
  };
  const wrapperStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    minHeight: toFinite(200, 200),
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  };
  return (
    <div style={wrapperStyle}>
      <RemotionPlayer
        component={EditorCompositionWithProps}
        inputProps={{ clips }}
        durationInFrames={safeDurationInFrames}
        compositionWidth={compWidth}
        compositionHeight={compHeight}
        fps={toFinite(FPS, 30)}
        style={safeStyle}
        controls
        className="block"
      />
    </div>
  );
}

function TimelineClipBlock({
  clip,
  isSelected,
  isDragged,
  isDragOver,
  onSelect,
  onRemove,
  onUpdate,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  clip: EditorClip;
  isSelected: boolean;
  isDragged: boolean;
  isDragOver: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<EditorClip>) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const durationSec = Math.max(
    0,
    toFinite(clip.trimEndSec, 0) - toFinite(clip.trimStartSec, 0)
  );
  const rawWidth = Math.max(80, Math.min(180, durationSec * 24));
  const widthPx = toFinite(rawWidth, 80);

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", clip.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
      className={`relative flex shrink-0 flex-col overflow-hidden rounded border-2 transition ${
        isSelected
          ? "border-accent"
          : isDragOver
            ? "border-foreground/40"
            : "border-foreground/20 hover:border-foreground/30"
      } ${isDragged ? "opacity-50" : ""}`}
      style={{ width: `${Math.max(1, widthPx)}px` }}
    >
      <div className="aspect-video w-full bg-foreground/10">
        <video
          src={clip.src}
          className="h-full w-full object-contain"
          muted
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = toFinite((e.target as HTMLVideoElement).duration, 0);
            if (d > 0) {
              onUpdate({
                durationSec: d,
                trimEndSec: Math.min(toFinite(clip.trimEndSec, d), d),
              });
            }
          }}
        />
      </div>
      <div className="flex items-center justify-between px-1 py-0.5 text-xs text-foreground/60">
        <span>{toFinite(durationSec, 0).toFixed(1)}s</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="rounded p-0.5 hover:bg-foreground/20 hover:text-foreground"
          aria-label="Remove clip"
        >
          ×
        </button>
      </div>
    </div>
  );
}
