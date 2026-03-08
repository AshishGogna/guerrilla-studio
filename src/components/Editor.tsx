"use client";

import { renderMediaOnWeb } from "@remotion/web-renderer";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Video } from "@remotion/media";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";

const RemotionPlayer = dynamic(
  () =>
    import("@remotion/player").then((mod) => mod.Player),
  { ssr: false }
);

const FPS = 30;
const COMP_WIDTH = 1920;
const COMP_HEIGHT = 1080;
const CLIP_WIDTH_PX_PER_SEC = 64;
const TRACK_HEIGHT_PX = 48;
const RULER_HEIGHT_PX = 36; // h-9 in Tailwind

/** Format seconds as HH:MM:SS (whole seconds). */
function formatTimeHMS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

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
  /** Track/layer index (0 = bottom). Clips on higher tracks render on top. */
  trackIndex: number;
  /** Video width in pixels (from loaded metadata). */
  width?: number;
  /** Video height in pixels (from loaded metadata). */
  height?: number;
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

  const trackIndices = [...new Set(clips.map((c) => toFinite(c.trackIndex, 0)))].sort(
    (a, b) => a - b
  );
  const totalDurationSec = Math.max(
    0.1,
    ...clips.map((c) => {
      const start = toFinite(c.startTimeSec, 0);
      const dur = Math.max(0, toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0));
      return start + dur;
    })
  );

  return (
    <>
      {trackIndices.map((trackIdx) => {
        const trackClips = clips.filter((c) => toFinite(c.trackIndex, 0) === trackIdx);
        if (trackClips.length === 0) return null;
        const segments: Segment[] = trackClips.map((c) => {
          const start = toFinite(c.startTimeSec, 0);
          const dur = Math.max(0, toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0));
          return { start, end: start + dur };
        });
        const sortedSeg = [...segments].sort((a, b) => a.start - b.start);
        const gaps: Segment[] = [];
        const gapToleranceSec = 1 / safeFps;
        let t = 0;
        for (const seg of sortedSeg) {
          if (seg.start > t + gapToleranceSec) gaps.push({ start: t, end: seg.start });
          t = Math.max(t, seg.end);
        }
        if (t + gapToleranceSec < totalDurationSec)
          gaps.push({ start: t, end: totalDurationSec });
        const sortedTrackClips = [...trackClips].sort(
          (a, b) => toFinite(a.startTimeSec, 0) - toFinite(b.startTimeSec, 0)
        );
        return (
          <AbsoluteFill key={`track-${trackIdx}`}>
            {gaps.map((gap, i) => {
              const fromFrame = Math.round(gap.start * safeFps);
              const durationInFrames = Math.max(
                1,
                Math.round((gap.end - gap.start) * safeFps)
              );
              return (
                <Sequence
                  key={`gap-${trackIdx}-${i}`}
                  from={fromFrame}
                  durationInFrames={durationInFrames}
                  name={`Gap T${trackIdx}-${i}`}
                >
                  <AbsoluteFill style={{ backgroundColor: "#000" }} />
                </Sequence>
              );
            })}
            {sortedTrackClips.map((clip) => {
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
          </AbsoluteFill>
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
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportResX, setExportResX] = useState(COMP_WIDTH);
  const [exportResY, setExportResY] = useState(COMP_HEIGHT);
  const [timelinePxPerSec, setTimelinePxPerSec] = useState(CLIP_WIDTH_PX_PER_SEC);
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
          trackIndex: 0,
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

  const handleClipMetadataLoaded = useCallback(
    (clipId: string, durationSec: number, width?: number, height?: number) => {
      setClips((prev) => {
        const clip = prev.find((c) => c.id === clipId);
        if (!clip) return prev;
        const oldEnd =
          toFinite(clip.startTimeSec, 0) +
          Math.max(0, toFinite(clip.trimEndSec, 0) - toFinite(clip.trimStartSec, 0));
        const newTrimEnd = Math.min(toFinite(clip.trimEndSec, durationSec), durationSec);
        const w = width != null && Number.isFinite(width) ? width : undefined;
        const h = height != null && Number.isFinite(height) ? height : undefined;
        let next = prev.map((c) =>
          c.id === clipId
            ? { ...c, durationSec, trimEndSec: newTrimEnd, ...(w != null && { width: w }), ...(h != null && { height: h }) }
            : c
        );
      const updated = next.find((c) => c.id === clipId)!;
      const newEnd =
        toFinite(updated.startTimeSec, 0) +
        Math.max(0, toFinite(updated.trimEndSec, 0) - toFinite(updated.trimStartSec, 0));
      const delta = oldEnd - newEnd;
      const updatedTrack = toFinite(updated.trackIndex, 0);
      if (delta <= 0) return next;
      return next.map((c) =>
        c.id === clipId
          ? c
          : toFinite(c.trackIndex, 0) === updatedTrack && toFinite(c.startTimeSec, 0) >= oldEnd
            ? { ...c, startTimeSec: Math.max(0, toFinite(c.startTimeSec, 0) - delta) }
            : c
      );
    });
  }, []);

  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineTracksRef = useRef<HTMLDivElement>(null);

  const applyClipPositionAndTrimOverlaps = useCallback(
    (
      prevClips: EditorClip[],
      movedId: string,
      newStartSec: number,
      trackIndex?: number
    ): EditorClip[] => {
      const aIndex = prevClips.findIndex((c) => c.id === movedId);
      if (aIndex === -1) return prevClips;
      const a = prevClips[aIndex];
      const aTrack = trackIndex ?? toFinite(a.trackIndex, 0);
      const aDur = Math.max(0, toFinite(a.trimEndSec, 0) - toFinite(a.trimStartSec, 0));
      const aStart = Math.max(0, newStartSec);
      const aEnd = aStart + aDur;

      let next = prevClips.map((c) =>
        c.id === movedId ? { ...c, startTimeSec: aStart, trackIndex: aTrack } : { ...c }
      );

      next = next.map((b) => {
        if (b.id === movedId) return b;
        if (toFinite(b.trackIndex, 0) !== aTrack) return b;
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
      initialTrackIndex: number,
      initialClientX: number,
      onSelectIfClick?: () => void
    ) => {
      let hasMoved = false;
      let currentTrackIndex = initialTrackIndex;
      const initialTimelineX = getTimelineX(initialClientX);
      const getTrackIndexFromY = (clientY: number): number => {
        const scrollEl = timelineRef.current;
        if (!scrollEl) return initialTrackIndex;
        const rect = scrollEl.getBoundingClientRect();
        const yInScrollContent = clientY - rect.top + scrollEl.scrollTop - RULER_HEIGHT_PX;
        return Math.max(0, Math.floor(yInScrollContent / TRACK_HEIGHT_PX));
      };
      const onMove = (e: MouseEvent) => {
        hasMoved = true;
        const currentTimelineX = getTimelineX(e.clientX);
        const deltaSec = (currentTimelineX - initialTimelineX) / timelinePxPerSec;
        const newStartSec = Math.max(0, initialStartTimeSec + deltaSec);
        currentTrackIndex = getTrackIndexFromY(e.clientY);
        setClips((prev) =>
          prev.map((c) =>
            c.id === id ? { ...c, startTimeSec: newStartSec, trackIndex: currentTrackIndex } : c
          )
        );
      };
      const onEnd = () => {
        if (!hasMoved) onSelectIfClick?.();
        else {
          setClips((prev) => {
            const clip = prev.find((c) => c.id === id);
            const start = clip ? toFinite(clip.startTimeSec, 0) : 0;
            return applyClipPositionAndTrimOverlaps(prev, id, start, currentTrackIndex);
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
    [getTimelineX, applyClipPositionAndTrimOverlaps, timelinePxPerSec]
  );

  const handleExport = useCallback(
    async (widthPx?: number, heightPx?: number) => {
      if (clips.length === 0) {
        alert("Add at least one clip to export.");
        return;
      }
      const w = toFinite(widthPx, COMP_WIDTH);
      const h = toFinite(heightPx, COMP_HEIGHT);
      if (w < 1 || h < 1) {
        alert("Resolution must be at least 1x1.");
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
            width: w,
            height: h,
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
        setShowExportModal(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Export failed");
      } finally {
        setExporting(false);
      }
    },
    [clips, durationInFrames]
  );

  const openExportModal = useCallback(() => {
    const sorted = [...clips].sort(
      (a, b) => toFinite(a.startTimeSec, 0) - toFinite(b.startTimeSec, 0)
    );
    const first = sorted[0];
    const defW =
      first?.width != null && Number.isFinite(first.width) ? first.width : COMP_WIDTH;
    const defH =
      first?.height != null && Number.isFinite(first.height) ? first.height : COMP_HEIGHT;
    setExportResX(defW);
    setExportResY(defH);
    setShowExportModal(true);
  }, [clips]);

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
      <div className="flex shrink-0 justify-center border-b border-foreground/10 bg-black/40 p-4"
      style={{ height: 300 }}>
        <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg bg-black">
          <RemotionPlayerPreview clips={clips} durationInFrames={durationInFrames} />
        </div>
      </div>

      {/* Timeline */}
      <div className="flex flex-1 flex-col overflow-hidden border-t border-foreground/10" style={{ height: 600 }}>
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
              onClick={() => {
                const zoom = Math.min(timelinePxPerSec + 8, 96);
                console.log("zoom in:", zoom);
                setTimelinePxPerSec((p) => zoom);
              }}
              title="Zoom in timeline"
              className="rounded border border-foreground/20 bg-foreground/10 p-1.5 hover:bg-foreground/20"
              aria-label="Zoom in timeline"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
                <path d="M11 8v6" />
                <path d="M8 11h6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setTimelinePxPerSec((p) => Math.max(p - 8, 8))}
              title="Zoom out timeline"
              className="rounded border border-foreground/20 bg-foreground/10 p-1.5 hover:bg-foreground/20"
              aria-label="Zoom out timeline"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
                <path d="M8 11h6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={openExportModal}
              disabled={clips.length === 0}
              className="rounded bg-accent px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
            >
              Export
            </button>
          </div>
        </div>
        <div ref={timelineRef} className="flex flex-1 flex-col overflow-auto p-4">
          <div
            className="flex shrink-0 flex-col"
            style={{
              width: `${Math.max(1, totalDurationSec * timelinePxPerSec)}px`,
              minWidth: "100%",
            }}
          >
            {/* Time ruler */}
            <div className="relative h-9 shrink-0 border-b border-foreground/20 bg-foreground/5">
              {(() => {
                const totalSec = Math.max(0, totalDurationSec);
                const minorStep = 0.25;
                const ticks: { sec: number; isMajor: boolean }[] = [];
                for (let t = 0; t <= totalSec + 0.001; t += minorStep) {
                  const isMajor = Math.abs(t - Math.round(t)) < 0.001;
                  ticks.push({ sec: t, isMajor });
                }
                return ticks.map(({ sec, isMajor }) => {
                  const leftPx = sec * timelinePxPerSec;
                  return (
                    <div
                      key={`tick-${sec}`}
                      className="absolute top-0 flex flex-col items-center"
                      style={{ left: `${leftPx}px` }}
                    >
                      <div
                        className={`shrink-0 bg-foreground/60 ${isMajor ? "w-0.5" : "w-px"} ${isMajor ? "h-5" : "h-2"}`}
                        style={{ minWidth: isMajor ? 2 : 1 }}
                      />
                      {isMajor && (
                        <span className="mt-0.5 shrink-0 text-[10px] font-medium tabular-nums text-foreground/70">
                          {formatTimeHMS(sec)}
                        </span>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
            {/* Track rows */}
            <div
              ref={timelineTracksRef}
              className="flex min-w-full shrink-0 flex-col"
              style={{
                width: `${Math.max(1, totalDurationSec * timelinePxPerSec)}px`,
                minHeight: `${Math.max(1, (clips.length ? Math.max(0, ...clips.map((c) => toFinite(c.trackIndex, 0))) + 1 : 1)) * TRACK_HEIGHT_PX}px`,
              }}
            >
              {(() => {
                const maxTrack = clips.length
                  ? Math.max(0, ...clips.map((c) => toFinite(c.trackIndex, 0)))
                  : 0;
                const trackIndices = Array.from(
                  { length: maxTrack + 1 },
                  (_, i) => i
                );
                return trackIndices.map((trackIdx) => (
                  <div
                    key={`track-${trackIdx}`}
                    className="relative shrink-0 border-b border-foreground/10 bg-foreground/[0.02]"
                    style={{ height: TRACK_HEIGHT_PX, minHeight: TRACK_HEIGHT_PX }}
                  >
                    <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-foreground/50">
                      {trackIdx + 1}
                    </span>
                    {clips
                      .filter((c) => toFinite(c.trackIndex, 0) === trackIdx)
                      .map((clip) => (
                        <div
                          key={clip.id}
                          className="absolute top-0 h-full"
                          style={{
                            left: `${(clip.startTimeSec ?? 0) * timelinePxPerSec}px`,
                          }}
                        >
                          <TimelineClipBlock
                            clip={clip}
                            pxPerSec={timelinePxPerSec}
                            isSelected={selectedClipId === clip.id}
                            isDragged={draggedId === clip.id}
                            onSelect={() => setSelectedClipId(clip.id)}
                            onRemove={() => removeClip(clip.id)}
                            onUpdate={(patch) => updateClip(clip.id, patch)}
                            onMetadataLoaded={(durationSec, w, h) =>
                              handleClipMetadataLoaded(clip.id, durationSec, w, h)
                            }
                            onPositionDragStart={(e) =>
                              handlePositionDragStart(
                                clip.id,
                                clip.startTimeSec ?? 0,
                                toFinite(clip.trackIndex, 0),
                                e.clientX,
                                () => setSelectedClipId(clip.id)
                              )
                            }
                          />
                        </div>
                      ))}
                  </div>
                ));
              })()}
            </div>
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

      {/* Export modal */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !exporting && setShowExportModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-modal-title"
        >
          <div
            className="rounded-lg border border-foreground/20 bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="export-modal-title" className="mb-4 text-lg font-medium text-foreground">
              Export
            </h2>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-foreground/80">
                Resolution: X × Y
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={exportResX}
                  onChange={(e) =>
                    setExportResX(Math.max(1, Number(e.target.value) || COMP_WIDTH))
                  }
                  className="w-24 rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-foreground/60">×</span>
                <input
                  type="number"
                  min={1}
                  value={exportResY}
                  onChange={(e) =>
                    setExportResY(Math.max(1, Number(e.target.value) || COMP_HEIGHT))
                  }
                  className="w-24 rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                disabled={exporting}
                className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleExport(exportResX, exportResY)}
                disabled={exporting}
                className="rounded bg-accent px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
              >
                {exporting ? "Exporting…" : "Export"}
              </button>
            </div>
          </div>
        </div>
      )}
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

function TimelineClipBlock({
  clip,
  pxPerSec,
  isSelected,
  isDragged,
  onSelect,
  onRemove,
  onUpdate,
  onMetadataLoaded,
  onPositionDragStart,
}: {
  clip: EditorClip;
  pxPerSec: number;
  isSelected: boolean;
  isDragged: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<EditorClip>) => void;
  onMetadataLoaded: (durationSec: number, width?: number, height?: number) => void;
  onPositionDragStart: (e: React.MouseEvent) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [trimDrag, setTrimDrag] = useState<{
    side: "left" | "right";
    startX: number;
    startValue: number;
  } | null>(null);

  const minClipWidthPx = Math.max(24, 0.1 * pxPerSec);
  const trimStart = toFinite(clip.trimStartSec, 0);
  const trimEnd = toFinite(clip.trimEndSec, 10);
  const durationSec = Math.max(0, trimEnd - trimStart);
  const fullDuration = Math.max(durationSec, toFinite(clip.durationSec, trimEnd || 10));
  const widthPx = Math.max(
    minClipWidthPx,
    Math.min(fullDuration * pxPerSec, durationSec * pxPerSec)
  );
  const safeWidth = toFinite(widthPx, minClipWidthPx);
  const wrapperWidthPx = Math.max(safeWidth, toFinite(fullDuration * pxPerSec, safeWidth));
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
          const el = e.target as HTMLVideoElement;
          const d = toFinite(el.duration, 0);
          const w = el.videoWidth;
          const h = el.videoHeight;
          if (d > 0) onMetadataLoaded(d, w, h);
        }}
      />
    </div>
  );
}
