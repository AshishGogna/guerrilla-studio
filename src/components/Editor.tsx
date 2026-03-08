"use client";

import { renderMediaOnWeb } from "@remotion/web-renderer";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AbsoluteFill, Sequence, Video, useVideoConfig } from "remotion";

const RemotionPlayer = dynamic(
  () =>
    import("@remotion/player").then((mod) => mod.Player),
  { ssr: false }
);

const FPS = 30;
const COMP_WIDTH = 1920;
const COMP_HEIGHT = 1080;
const CLIP_WIDTH_PX_PER_SEC = 24;

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
  /** Start time on the timeline in seconds (for gaps and ordering). */
  startTimeSec: number;
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

  type Segment = { start: number; end: number };
  const clipSegments: Segment[] = clips.map((c) => {
    const start = toFinite(c.startTimeSec, 0);
    const dur = Math.max(0, toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0));
    return { start, end: start + dur };
  });
  const totalDurationSec = Math.max(
    0.1,
    ...clipSegments.map((s) => s.end)
  );

  const gaps: Segment[] = [];
  const sorted = [...clipSegments].sort((a, b) => a.start - b.start);
  const gapToleranceSec = 1 / safeFps;
  let t = 0;
  for (const seg of sorted) {
    if (seg.start > t + gapToleranceSec) gaps.push({ start: t, end: seg.start });
    t = Math.max(t, seg.end);
  }
  if (t + gapToleranceSec < totalDurationSec) gaps.push({ start: t, end: totalDurationSec });

  const sortedClips = [...clips].sort(
    (a, b) => toFinite(a.startTimeSec, 0) - toFinite(b.startTimeSec, 0)
  );

  return (
    <>
      {gaps.map((gap, i) => {
        const fromFrame = Math.round(gap.start * safeFps);
        const durationInFrames = Math.max(1, Math.round((gap.end - gap.start) * safeFps));
        return (
          <Sequence
            key={`gap-${i}`}
            from={fromFrame}
            durationInFrames={durationInFrames}
            name={`Gap ${i}`}
          >
            <AbsoluteFill style={{ backgroundColor: "#000" }} />
          </Sequence>
        );
      })}
      {sortedClips.map((clip) => {
        const durationSec = Math.max(
          0,
          toFinite(clip.trimEndSec, 0) - toFinite(clip.trimStartSec, 0)
        );
        const durationInFrames = Math.max(
          1,
          Math.round(toFinite(durationSec * safeFps, 0))
        );
        const fromFrame = Math.round(toFinite(clip.startTimeSec, 0) * safeFps);
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
        const trimAfter = trimAfterFrames > 0 ? trimAfterFrames : undefined;

        return (
          <Sequence
            key={clip.id}
            from={fromFrame}
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
      })}
    </>
  );
}

export default function Editor() {
  const [clips, setClips] = useState<EditorClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalDurationSec = Math.max(
    0.1,
    ...clips.map((c) => {
      const start = toFinite(c.startTimeSec, 0);
      const dur = Math.max(0, toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0));
      return start + dur;
    }),
    0
  );
  const durationInFrames = Math.max(
    1,
    Math.ceil(toFinite(totalDurationSec * FPS, 0))
  );

  const addClip = useCallback((src: string, durationSec?: number) => {
    const id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const endSec = toFinite(durationSec, 10);
    setClips((prev) => {
      const endOfTimeline =
        prev.length === 0
          ? 0
          : Math.max(
              ...prev.map(
                (c) =>
                  toFinite(c.startTimeSec, 0) +
                  Math.max(0, toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0))
              )
            );
      return [
        ...prev,
        {
          id,
          src,
          trimStartSec: 0,
          trimEndSec: Math.max(0, endSec),
          durationSec: Number.isFinite(Number(durationSec)) ? durationSec : undefined,
          startTimeSec: endOfTimeline,
        },
      ];
    });
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

  const timelineRef = useRef<HTMLDivElement>(null);

  const applyClipPositionAndTrimOverlaps = useCallback(
    (prevClips: EditorClip[], movedId: string, newStartSec: number): EditorClip[] => {
      const aIndex = prevClips.findIndex((c) => c.id === movedId);
      if (aIndex === -1) return prevClips;
      const a = prevClips[aIndex];
      const aDur = Math.max(0, toFinite(a.trimEndSec, 0) - toFinite(a.trimStartSec, 0));
      const aStart = Math.max(0, newStartSec);
      const aEnd = aStart + aDur;

      let next = prevClips.map((c) =>
        c.id === movedId ? { ...c, startTimeSec: aStart } : { ...c }
      );

      next = next.map((b) => {
        if (b.id === movedId) return b;
        const bStart = toFinite(b.startTimeSec, 0);
        const bDur = Math.max(0, toFinite(b.trimEndSec, 0) - toFinite(b.trimStartSec, 0));
        const bEnd = bStart + bDur;
        if (aEnd <= bStart || aStart >= bEnd) return b;

        const bTrimStart = toFinite(b.trimStartSec, 0);
        const bTrimEnd = toFinite(b.trimEndSec, 0);

        if (aEnd > bStart && aEnd < bEnd && aStart <= bStart) {
          const trimOff = aEnd - bStart;
          return {
            ...b,
            startTimeSec: aEnd,
            trimStartSec: Math.min(bTrimEnd - MIN_TRIM_DURATION_SEC, bTrimStart + trimOff),
          };
        }
        if (aStart > bStart && aStart < bEnd && aEnd >= bEnd) {
          const newDur = aStart - bStart;
          return {
            ...b,
            trimEndSec: Math.max(bTrimStart + MIN_TRIM_DURATION_SEC, bTrimStart + newDur),
          };
        }
        if (aStart <= bStart && aEnd >= bEnd) {
          return { ...b, trimEndSec: bTrimStart };
        }
        if (bStart < aStart && bEnd > aEnd) {
          return {
            ...b,
            trimEndSec: Math.max(
              bTrimStart + MIN_TRIM_DURATION_SEC,
              bTrimStart + (aStart - bStart)
            ),
          };
        }
        if (aStart < bEnd && aEnd > bStart && aStart > bStart) {
          const newDur = aStart - bStart;
          return {
            ...b,
            trimEndSec: Math.max(bTrimStart + MIN_TRIM_DURATION_SEC, bTrimStart + newDur),
          };
        }
        if (aEnd > bStart && aEnd < bEnd) {
          const trimOff = aEnd - bStart;
          return {
            ...b,
            startTimeSec: aEnd,
            trimStartSec: Math.min(bTrimEnd - MIN_TRIM_DURATION_SEC, bTrimStart + trimOff),
          };
        }
        return b;
      });

      return next;
    },
    []
  );

  const getTimelineX = useCallback((clientX: number): number => {
    if (!timelineRef.current) return 0;
    const el = timelineRef.current;
    const rect = el.getBoundingClientRect();
    return clientX - rect.left + el.scrollLeft;
  }, []);

  const handlePositionDragStart = useCallback(
    (
      id: string,
      initialStartTimeSec: number,
      initialClientX: number,
      onSelectIfClick?: () => void
    ) => {
      let hasMoved = false;
      const initialTimelineX = getTimelineX(initialClientX);
      const onMove = (e: MouseEvent) => {
        hasMoved = true;
        const currentTimelineX = getTimelineX(e.clientX);
        const deltaSec = (currentTimelineX - initialTimelineX) / CLIP_WIDTH_PX_PER_SEC;
        const newStartSec = Math.max(0, initialStartTimeSec + deltaSec);
        setClips((prev) =>
          prev.map((c) => (c.id === id ? { ...c, startTimeSec: newStartSec } : c))
        );
      };
      const onEnd = () => {
        if (!hasMoved) onSelectIfClick?.();
        else {
          setClips((prev) => {
            const clip = prev.find((c) => c.id === id);
            const start = clip ? toFinite(clip.startTimeSec, 0) : 0;
            return applyClipPositionAndTrimOverlaps(prev, id, start);
          });
        }
        setDraggedId(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onEnd);
        document.body.style.removeProperty("user-select");
        document.body.style.removeProperty("cursor");
      };
      setDraggedId(id);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd, { once: true });
    },
    [getTimelineX, applyClipPositionAndTrimOverlaps]
  );

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key !== "Delete" && e.key !== "Backspace") ||
        selectedClipId == null
      )
        return;
      const target = document.activeElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable)
      )
        return;
      e.preventDefault();
      removeClip(selectedClipId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedClipId, removeClip]);

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
        <div ref={timelineRef} className="flex flex-1 overflow-x-auto overflow-y-hidden p-4">
          <div
            className="relative h-12 min-w-full"
            style={{
              width: `${Math.max(1, totalDurationSec * CLIP_WIDTH_PX_PER_SEC)}px`,
            }}
          >
            {clips.map((clip) => (
              <div
                key={clip.id}
                className="absolute top-0 h-full"
                style={{
                  left: `${(clip.startTimeSec ?? 0) * CLIP_WIDTH_PX_PER_SEC}px`,
                }}
              >
                <TimelineClipBlock
                  clip={clip}
                  isSelected={selectedClipId === clip.id}
                  isDragged={draggedId === clip.id}
                  onSelect={() => setSelectedClipId(clip.id)}
                  onRemove={() => removeClip(clip.id)}
                  onUpdate={(patch) => updateClip(clip.id, patch)}
                  onPositionDragStart={(e) =>
                    handlePositionDragStart(
                      clip.id,
                      clip.startTimeSec ?? 0,
                      e.clientX,
                      () => setSelectedClipId(clip.id)
                    )
                  }
                />
              </div>
            ))}
          </div>
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

const MIN_TRIM_DURATION_SEC = 0.1;
const MIN_CLIP_WIDTH_PX = Math.max(24, 0.1 * CLIP_WIDTH_PX_PER_SEC); // at least 0.1s, min 24px for usability

function TimelineClipBlock({
  clip,
  isSelected,
  isDragged,
  onSelect,
  onRemove,
  onUpdate,
  onPositionDragStart,
}: {
  clip: EditorClip;
  isSelected: boolean;
  isDragged: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<EditorClip>) => void;
  onPositionDragStart: (e: React.MouseEvent) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [trimDrag, setTrimDrag] = useState<{
    side: "left" | "right";
    startX: number;
    startValue: number;
  } | null>(null);

  const trimStart = toFinite(clip.trimStartSec, 0);
  const trimEnd = toFinite(clip.trimEndSec, 10);
  const durationSec = Math.max(0, trimEnd - trimStart);
  const fullDuration = Math.max(durationSec, toFinite(clip.durationSec, trimEnd || 10));
  const widthPx = Math.max(
    MIN_CLIP_WIDTH_PX,
    Math.min(fullDuration * CLIP_WIDTH_PX_PER_SEC, durationSec * CLIP_WIDTH_PX_PER_SEC)
  );
  const safeWidth = toFinite(widthPx, MIN_CLIP_WIDTH_PX);
  const wrapperWidthPx = Math.max(safeWidth, toFinite(fullDuration * CLIP_WIDTH_PX_PER_SEC, safeWidth));
  const clipLeftPx =
    fullDuration > 0
      ? (trimStart / fullDuration) * wrapperWidthPx
      : 0;

  useEffect(() => {
    if (!trimDrag || !barRef.current) return;
    const bar = barRef.current;
    const fullDur = Math.max(fullDuration, 0.1);

    const onMouseMove = (e: MouseEvent) => {
      const rect = bar.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const sec = Math.max(0, Math.min(1, x)) * fullDur;

      if (trimDrag.side === "left") {
        const newStart = Math.max(
          0,
          Math.min(sec, trimEnd - MIN_TRIM_DURATION_SEC)
        );
        onUpdate({ trimStartSec: newStart });
      } else {
        const newEnd = Math.max(
          trimStart + MIN_TRIM_DURATION_SEC,
          Math.min(fullDur, sec)
        );
        onUpdate({ trimEndSec: newEnd });
      }
    };
    const onMouseUp = () => setTrimDrag(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [trimDrag, fullDuration, trimStart, trimEnd, onUpdate]);

  return (
    <div
      ref={barRef}
      role="button"
      tabIndex={0}
      onMouseDown={(e) => {
        if (e.button === 0) onPositionDragStart(e);
      }}
      onClick={(e) => e.stopPropagation()}
      className="relative h-12 shrink-0 cursor-grab active:cursor-grabbing"
      style={{ width: `${Math.max(1, wrapperWidthPx)}px` }}
    >
      <div
        className={`absolute top-0 bottom-0 flex items-center overflow-hidden rounded border-2 transition ${
          isSelected
            ? "border-accent"
            : "border-foreground/20 hover:border-foreground/30"
        } ${isDragged ? "opacity-50" : ""}`}
        style={{
          left: `${clipLeftPx}px`,
          width: `${Math.max(1, safeWidth)}px`,
        }}
      >
        <div className="absolute inset-0 bg-foreground/15" />
        <div
          role="slider"
          aria-label="Trim start"
          className="absolute left-0 inset-y-0 z-10 w-2 cursor-ew-resize border-r border-foreground/30 hover:bg-foreground/20"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTrimDrag({ side: "left", startX: e.clientX, startValue: trimStart });
          }}
        />
        <div
          role="slider"
          aria-label="Trim end"
          className="absolute right-0 inset-y-0 z-10 w-2 cursor-ew-resize border-l border-foreground/30 hover:bg-foreground/20"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTrimDrag({ side: "right", startX: e.clientX, startValue: trimEnd });
          }}
        />
      </div>
      <video
        src={clip.src}
        className="hidden"
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = toFinite((e.target as HTMLVideoElement).duration, 0);
          if (d > 0) {
            onUpdate({
              durationSec: d,
              trimEndSec: Math.min(trimEnd, d),
            });
          }
        }}
      />
    </div>
  );
}
