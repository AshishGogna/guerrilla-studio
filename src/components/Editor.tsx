"use client";

import { renderMediaOnWeb } from "@remotion/web-renderer";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Video } from "@remotion/media";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";

const RemotionPlayer = dynamic(
  () =>
    import("@remotion/player").then((mod) => mod.Player),
  { ssr: false }
);

type PlayerRefType = import("@remotion/player").PlayerRef;

const FPS = 30;
const COMP_WIDTH = 1920;
const COMP_HEIGHT = 1080;
const CLIP_WIDTH_PX_PER_SEC = 64;
const TRACK_HEIGHT_PX = 48;
const RULER_HEIGHT_PX = 36; // h-9 in Tailwind
const TIMELINE_PADDING_PX = 16; // p-4 on scroll container

/** Effective trim for display: per-track for combined, else main trim. */
function getEffectiveTrim(
  clip: EditorClip,
  trackType: "video" | "audio"
): { trimStartSec: number; trimEndSec: number } {
  const k = clip.kind ?? "combined";
  if (k !== "combined") {
    return {
      trimStartSec: toFinite(clip.trimStartSec, 0),
      trimEndSec: toFinite(clip.trimEndSec, 10),
    };
  }
  if (trackType === "video") {
    return {
      trimStartSec: toFinite(clip.trimStartSecVideo ?? clip.trimStartSec, 0),
      trimEndSec: toFinite(clip.trimEndSecVideo ?? clip.trimEndSec, 10),
    };
  }
  return {
    trimStartSec: toFinite(clip.trimStartSecAudio ?? clip.trimStartSec, 0),
    trimEndSec: toFinite(clip.trimEndSecAudio ?? clip.trimEndSec, 10),
  };
}

/** Get a short display name for a clip from its src (filename or fallback). */
function getClipDisplayName(clip: EditorClip): string {
  try {
    if (clip.src.startsWith("blob:")) return "Uploaded clip";
    const u = new URL(clip.src, "file:");
    const seg = u.pathname.split("/").filter(Boolean).pop();
    if (seg) return decodeURIComponent(seg);
  } catch {
    // ignore
  }
  return clip.id;
}

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

export type ClipKind = "video" | "audio" | "combined";

export interface EditorClip {
  id: string;
  src: string;
  trimStartSec: number;
  trimEndSec: number;
  durationSec?: number;
  /** Start time on the timeline in seconds (for gaps and ordering). */
  startTimeSec: number;
  /** Track index (0, 1, 2…). Any clip type can be on any track. */
  trackIndex: number;
  /** When 'combined', clip appears on both video and audio rows; unlink splits into video + audio. */
  kind?: ClipKind;
  /** Trim used when this clip is shown on the video row (combined only). */
  trimStartSecVideo?: number;
  trimEndSecVideo?: number;
  /** Trim used when this clip is shown on the audio row (combined only). */
  trimStartSecAudio?: number;
  trimEndSecAudio?: number;
  /** Video width in pixels (from loaded metadata). */
  width?: number;
  /** Video height in pixels (from loaded metadata). */
  height?: number;
  /** Normalized amplitude samples for waveform (0–1), one per pixel column. */
  waveformData?: number[];
}

const WAVEFORM_SAMPLES = 256;

/** Decode audio from a media URL and return normalized waveform samples. */
async function decodeAudioWaveform(src: string): Promise<number[]> {
  const res = await fetch(src, { mode: "cors" });
  const buf = await res.arrayBuffer();
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const audio = await ctx.decodeAudioData(buf);
  ctx.close();
  const ch = audio.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / WAVEFORM_SAMPLES));
  const out: number[] = [];
  for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
    const start = i * step;
    let max = 0;
    for (let j = 0; j < step && start + j < ch.length; j++) {
      max = Math.max(max, Math.abs(ch[start + j]));
    }
    out.push(max);
  }
  const peak = Math.max(...out, 1e-9);
  return out.map((v) => v / peak);
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

  const maxTrackIdx = trackIndices.length ? Math.max(...trackIndices) : 0;
  return (
    <>
      {[...trackIndices].reverse().map((trackIdx) => {
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
              const isBottomTrack = trackIdx === maxTrackIdx;
              return (
                <Sequence
                  key={`gap-${trackIdx}-${i}`}
                  from={fromFrame}
                  durationInFrames={durationInFrames}
                  name={`Gap T${trackIdx}-${i}`}
                >
                  <AbsoluteFill
                    style={{
                      backgroundColor: isBottomTrack ? "#000" : "transparent",
                    }}
                  />
                </Sequence>
              );
            })}
            {sortedTrackClips.flatMap((clip) => {
              const clipKind = clip.kind ?? "combined";
              const overlapSecondsForClip = (clipStartSec: number, clipEndSec: number): [number, number][] =>
                clips
                  .filter(
                    (c) =>
                      c.id !== clip.id &&
                      toFinite(c.trackIndex, 0) < toFinite(clip.trackIndex, 0) &&
                      (c.kind ?? "combined") !== "video"
                  )
                  .map((c) => {
                    const cStart = toFinite(c.startTimeSec, 0);
                    const cDur = Math.max(
                      0,
                      toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0)
                    );
                    const cEnd = cStart + cDur;
                    const start = Math.max(clipStartSec, cStart);
                    const end = Math.min(clipEndSec, cEnd);
                    return [start, end] as [number, number];
                  })
                  .filter(([s, e]) => e > s);

              const renderClipSequence = (
                trimStart: number,
                trimEnd: number,
                volume: number | ((frame: number) => number),
                isAudioOnly: boolean,
                keySuffix: string
              ) => {
                const durationSec = Math.max(0, trimEnd - trimStart);
                const durationInFrames = Math.max(
                  1,
                  Math.round(toFinite(durationSec * safeFps, 0))
                );
                const fromFrame = Math.round(toFinite(clip.startTimeSec, 0) * safeFps);
                const trimBefore = Math.max(0, Math.round(trimStart * safeFps));
                const durationSecClip = toFinite(clip.durationSec, 0);
                const trimAfterFrames =
                  clip.durationSec != null && durationSecClip > 0
                    ? Math.round((durationSecClip - trimEnd) * safeFps)
                    : 0;
                const trimAfter = trimAfterFrames > 0 ? trimAfterFrames : undefined;
                const clipStartSec = toFinite(clip.startTimeSec, 0);
                const clipEndSec = clipStartSec + durationSec;
                const overlapSeconds = overlapSecondsForClip(clipStartSec, clipEndSec);
                const vol =
                  typeof volume === "number"
                    ? volume
                    : overlapSeconds.length > 0
                      ? (frame: number) => {
                          const t = frame / safeFps;
                          return overlapSeconds.some(([s, e]) => t >= s && t < e)
                            ? 0
                            : volume(frame);
                        }
                      : volume;
                return (
                  <Sequence
                    key={`${clip.id}-${keySuffix}`}
                    from={fromFrame}
                    durationInFrames={durationInFrames}
                    name={`Clip ${clip.id} ${keySuffix}`}
                  >
                    <AbsoluteFill>
                      <Video
                        src={clip.src}
                        trimBefore={trimBefore}
                        {...(trimAfter !== undefined && { trimAfter })}
                        volume={vol}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          ...(isAudioOnly && {
                            position: "absolute",
                            width: 0,
                            height: 0,
                            overflow: "hidden",
                            opacity: 0,
                            pointerEvents: "none",
                          }),
                        }}
                      />
                    </AbsoluteFill>
                  </Sequence>
                );
              };

              if (clipKind === "combined") {
                const videoTrim = getEffectiveTrim(clip, "video");
                const audioTrim = getEffectiveTrim(clip, "audio");
                return [
                  renderClipSequence(
                    videoTrim.trimStartSec,
                    videoTrim.trimEndSec,
                    0,
                    false,
                    "video"
                  ),
                  renderClipSequence(
                    audioTrim.trimStartSec,
                    audioTrim.trimEndSec,
                    1,
                    true,
                    "audio"
                  ),
                ];
              }
              const trimStart = toFinite(clip.trimStartSec, 0);
              const trimEnd = toFinite(clip.trimEndSec, 10);
              const clipStartSec = toFinite(clip.startTimeSec, 0);
              const clipEndSec = clipStartSec + Math.max(0, trimEnd - trimStart);
              const overlapSeconds = overlapSecondsForClip(clipStartSec, clipEndSec);
              const volume =
                clipKind === "video"
                  ? 0
                  : overlapSeconds.length > 0
                    ? (frame: number) => {
                        const t = frame / safeFps;
                        return overlapSeconds.some(([s, e]) => t >= s && t < e) ? 0 : 1;
                      }
                    : 1;
              return [
                renderClipSequence(
                  trimStart,
                  trimEnd,
                  volume,
                  clipKind === "audio",
                  "main"
                ),
              ];
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
  const [playheadTimeSec, setPlayheadTimeSec] = useState(0);
  const [addUrl, setAddUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<PlayerRefType | null>(null);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const timelinePxPerSecRef = useRef(timelinePxPerSec);
  timelinePxPerSecRef.current = timelinePxPerSec;

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
      const maxTrack =
        prev.length === 0 ? -1 : Math.max(...prev.map((c) => toFinite(c.trackIndex, 0)));
      const videoTrack = maxTrack + 1;
      const audioTrack = maxTrack + 2;
      const base = {
        src,
        trimStartSec: 0,
        trimEndSec: Math.max(0, endSec),
        durationSec: Number.isFinite(Number(durationSec)) ? durationSec : undefined,
        startTimeSec: endOfTimeline,
      };
      const videoId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const audioId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      return [
        ...prev,
        { ...base, id: videoId, trackIndex: videoTrack, kind: "video" as const },
        { ...base, id: audioId, trackIndex: audioTrack, kind: "audio" as const },
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

  const [clipContextMenu, setClipContextMenu] = useState<{
    clipId: string;
    x: number;
    y: number;
  } | null>(null);

  const unlinkClip = useCallback((clipId: string) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === clipId);
      if (!clip || (clip.kind && clip.kind !== "combined")) return prev;
      const videoTrim = getEffectiveTrim(clip, "video");
      const audioTrim = getEffectiveTrim(clip, "audio");
      const videoId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const audioId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const videoClip: EditorClip = {
        ...clip,
        id: videoId,
        kind: "video",
        trimStartSec: videoTrim.trimStartSec,
        trimEndSec: videoTrim.trimEndSec,
      };
      const audioClip: EditorClip = {
        ...clip,
        id: audioId,
        kind: "audio",
        trimStartSec: audioTrim.trimStartSec,
        trimEndSec: audioTrim.trimEndSec,
      };
      return prev
        .filter((c) => c.id !== clipId)
        .concat([videoClip, audioClip]);
    });
    setClipContextMenu(null);
    setSelectedClipId(null);
  }, []);

  useEffect(() => {
    if (!clipContextMenu) return;
    const close = () => setClipContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [clipContextMenu]);

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

  /** Update only the trim for the given track (video or audio row). Prevents trimming one row from changing the other. */
  const updateClipTrimForTrack = useCallback(
    (id: string, patch: { trimStartSec?: number; trimEndSec?: number }, trackType: "video" | "audio") => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const k = c.kind ?? "combined";
          if (k !== "combined") {
            return { ...c, ...patch };
          }
          if (trackType === "video") {
            return {
              ...c,
              ...(patch.trimStartSec != null && { trimStartSecVideo: patch.trimStartSec }),
              ...(patch.trimEndSec != null && { trimEndSecVideo: patch.trimEndSec }),
            };
          }
          return {
            ...c,
            ...(patch.trimStartSec != null && { trimStartSecAudio: patch.trimStartSec }),
            ...(patch.trimEndSec != null && { trimEndSecAudio: patch.trimEndSec }),
          };
        })
      );
    },
    []
  );

  const handleClipMetadataLoaded = useCallback(
    (clipId: string, durationSec: number, width?: number, height?: number) => {
      setClips((prev) => {
        const clip = prev.find((c) => c.id === clipId);
        if (!clip) return prev;
        const newTrimEnd = Math.min(toFinite(clip.trimEndSec, durationSec), durationSec);
        const w = width != null && Number.isFinite(width) ? width : undefined;
        const h = height != null && Number.isFinite(height) ? height : undefined;
        const src = clip.src;
        const startSec = toFinite(clip.startTimeSec, 0);
        let next = prev.map((c) => {
          if (c.id === clipId) {
            return { ...c, durationSec, trimEndSec: newTrimEnd, ...(w != null && { width: w }), ...(h != null && { height: h }) };
          }
          if (c.src === src && toFinite(c.startTimeSec, 0) === startSec) {
            return { ...c, durationSec, trimEndSec: newTrimEnd };
          }
          return c;
        });
        const updated = next.find((c) => c.id === clipId)!;
        const oldEnd =
          toFinite(clip.startTimeSec, 0) +
          Math.max(0, toFinite(clip.trimEndSec, 0) - toFinite(clip.trimStartSec, 0));
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
    },
    []
  );

  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineTracksRef = useRef<HTMLDivElement>(null);

  /** True if two clips are on the same track row (both video row or both audio row) for overlap trimming. */
  const sameTrackRow = useCallback((a: EditorClip, b: EditorClip): boolean => {
    if (toFinite(a.trackIndex, 0) !== toFinite(b.trackIndex, 0)) return false;
    const aKind = a.kind ?? "combined";
    const bKind = b.kind ?? "combined";
    if (aKind === "combined" || bKind === "combined") return true;
    return aKind === bKind;
  }, []);

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
        if (!sameTrackRow({ ...a, trackIndex: aTrack, startTimeSec: aStart }, b)) return b;
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
    [sameTrackRow]
  );

  const getTimelineX = useCallback((clientX: number): number => {
    if (!timelineRef.current) return 0;
    const el = timelineRef.current;
    const rect = el.getBoundingClientRect();
    return clientX - rect.left + el.scrollLeft;
  }, []);

  const handlePlayheadDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const onMove = (e: MouseEvent) => {
        const x = Math.max(0, getTimelineX(e.clientX) - TIMELINE_PADDING_PX);
        const sec = Math.max(0, Math.min(totalDurationSec, x / timelinePxPerSec));
        setPlayheadTimeSec(sec);
        playerRef.current?.seekTo(Math.round(sec * FPS));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };
      onMove(e.nativeEvent);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp, { once: true });
    },
    [getTimelineX, totalDurationSec, timelinePxPerSec]
  );

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

  const lastWasPlayingRef = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      const player = playerRef.current;
      const el = playheadLineRef.current;
      const playing = player?.isPlaying?.() ?? false;
      if (playing && el && player) {
        lastWasPlayingRef.current = true;
        const frame = player.getCurrentFrame();
        if (typeof frame === "number" && Number.isFinite(frame)) {
          const sec = frame / FPS;
          const leftPx = sec * timelinePxPerSecRef.current;
          el.style.left = `${leftPx}px`;
        }
      } else if (lastWasPlayingRef.current) {
        lastWasPlayingRef.current = false;
        const frame = player?.getCurrentFrame?.();
        if (typeof frame === "number" && Number.isFinite(frame)) {
          setPlayheadTimeSec(frame / FPS);
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, [clips.length]);

  const handleRulerClick = useCallback(
    (e: React.MouseEvent) => {
      const x = Math.max(0, getTimelineX(e.clientX) - TIMELINE_PADDING_PX);
      const sec = Math.max(0, Math.min(totalDurationSec, x / timelinePxPerSec));
      setPlayheadTimeSec(sec);
      playerRef.current?.seekTo(Math.round(sec * FPS));
    },
    [getTimelineX, totalDurationSec, timelinePxPerSec]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      {/* Preview */}
      <div className="flex shrink-0 justify-center border-b border-foreground/10 bg-black/40 p-4"
      style={{ height: 300 }}>
        <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg bg-black">
          <RemotionPlayerPreview
            ref={playerRef}
            clips={clips}
            durationInFrames={durationInFrames}
          />
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
            className="relative flex shrink-0 flex-col"
            style={{
              width: `${Math.max(1, totalDurationSec * timelinePxPerSec)}px`,
              minWidth: "100%",
            }}
          >
            {/* Time ruler - click to seek */}
            <div
              className="relative h-9 shrink-0 cursor-pointer border-b border-foreground/20 bg-foreground/5"
              onClick={handleRulerClick}
              role="button"
              aria-label="Click to seek playhead"
            >
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
                const rows = Array.from({ length: maxTrack + 1 }, (_, i) => i);
                const blockHandlers = (clip: EditorClip, trackType: "video" | "audio") => ({
                  onUpdate: (patch: Partial<EditorClip>) =>
                    updateClipTrimForTrack(clip.id, patch, trackType),
                  onPositionDragStart: (e: React.MouseEvent) =>
                    handlePositionDragStart(
                      clip.id,
                      clip.startTimeSec ?? 0,
                      toFinite(clip.trackIndex, 0),
                      e.clientX,
                      () => setSelectedClipId(clip.id)
                    ),
                  onContextMenu: (e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setClipContextMenu({ clipId: clip.id, x: e.clientX, y: e.clientY });
                  },
                });
                return rows.map((trackIdx) => {
                  const trackClips = clips.filter(
                    (c) => toFinite(c.trackIndex, 0) === trackIdx
                  );
                  return (
                    <div
                      key={`track-${trackIdx}`}
                      className="relative shrink-0 border-b border-foreground/10 bg-foreground/[0.02]"
                      style={{ height: TRACK_HEIGHT_PX, minHeight: TRACK_HEIGHT_PX }}
                    >
                      <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-foreground/50">
                        {trackIdx + 1}
                      </span>
                      {trackClips.map((clip) => {
                        const k = clip.kind ?? "combined";
                        const slotLeft = `${(clip.startTimeSec ?? 0) * timelinePxPerSec}px`;
                        const displayClipV = { ...clip, ...getEffectiveTrim(clip, "video") } as EditorClip;
                        const displayClipA = { ...clip, ...getEffectiveTrim(clip, "audio") } as EditorClip;
                        if (k === "combined") {
                          const trimStart = toFinite(displayClipV.trimStartSec, 0);
                          const trimEnd = toFinite(displayClipV.trimEndSec, 10);
                          const dur = Math.max(0, trimEnd - trimStart);
                          const fullDur = Math.max(dur, toFinite(clip.durationSec, trimEnd || 10));
                          const slotW = Math.max(24, fullDur * timelinePxPerSec);
                          return (
                            <div
                              key={clip.id}
                              className="absolute top-0 flex h-full flex-col"
                              style={{ left: slotLeft, width: `${slotW}px` }}
                            >
                              <div className="h-1/2 min-h-0 overflow-hidden">
                                <TimelineClipBlock
                                  clip={displayClipV}
                                  pxPerSec={timelinePxPerSec}
                                  isSelected={selectedClipId === clip.id}
                                  isDragged={draggedId === clip.id}
                                  onSelect={() => setSelectedClipId(clip.id)}
                                  onRemove={() => removeClip(clip.id)}
                                  onMetadataLoaded={(durationSec, w, h) =>
                                    handleClipMetadataLoaded(clip.id, durationSec, w, h)
                                  }
                                  {...blockHandlers(clip, "video")}
                                />
                              </div>
                              <div className="h-1/2 min-h-0 overflow-hidden">
                                <TimelineAudioBlock
                                  clip={displayClipA}
                                  pxPerSec={timelinePxPerSec}
                                  isSelected={selectedClipId === clip.id}
                                  isDragged={draggedId === clip.id}
                                  onSelect={() => setSelectedClipId(clip.id)}
                                  onWaveformLoaded={(data) =>
                                    updateClip(clip.id, { waveformData: data })
                                  }
                                  {...blockHandlers(clip, "audio")}
                                />
                              </div>
                            </div>
                          );
                        }
                        if (k === "audio") {
                          return (
                            <div key={clip.id} className="absolute top-0 h-full" style={{ left: slotLeft }}>
                              <TimelineAudioBlock
                                clip={displayClipA}
                                pxPerSec={timelinePxPerSec}
                                isSelected={selectedClipId === clip.id}
                                isDragged={draggedId === clip.id}
                                onSelect={() => setSelectedClipId(clip.id)}
                                onWaveformLoaded={(data) =>
                                  updateClip(clip.id, { waveformData: data })
                                }
                                {...blockHandlers(clip, "audio")}
                              />
                            </div>
                          );
                        }
                        return (
                          <div key={clip.id} className="absolute top-0 h-full" style={{ left: slotLeft }}>
                            <TimelineClipBlock
                              clip={displayClipV}
                              pxPerSec={timelinePxPerSec}
                              isSelected={selectedClipId === clip.id}
                              isDragged={draggedId === clip.id}
                              onSelect={() => setSelectedClipId(clip.id)}
                              onRemove={() => removeClip(clip.id)}
                              onMetadataLoaded={(durationSec, w, h) =>
                                handleClipMetadataLoaded(clip.id, durationSec, w, h)
                              }
                              {...blockHandlers(clip, "video")}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
            {/* Clip context menu */}
            {clipContextMenu &&
              createPortal(
                (() => {
                  const clip = clips.find((c) => c.id === clipContextMenu.clipId);
                  const canUnlink = clip && (clip.kind ?? "combined") === "combined";
                  return (
                    <div
                      className="fixed z-50 min-w-[140px] rounded-md border border-foreground/20 bg-background py-1 shadow-lg"
                      style={{
                        left: clipContextMenu.x,
                        top: clipContextMenu.y,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={!canUnlink}
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => unlinkClip(clipContextMenu.clipId)}
                      >
                        Unlink
                      </button>
                    </div>
                  );
                })(),
                document.body
              )}
            {/* Playhead: vertical line at current time, draggable from ruler */}
            <div
              ref={playheadLineRef}
              className="absolute top-0 bottom-0 z-30 w-2 -translate-x-1/2"
              style={{ left: `${playheadTimeSec * timelinePxPerSec}px` }}
            >
              <div
                className="absolute inset-0 bg-red-500 pointer-events-none"
                style={{ width: 2, marginLeft: -1 }}
              />
              <div
                className="absolute left-0 top-0 cursor-ew-resize bg-red-500/80 hover:bg-red-500"
                style={{
                  width: 8,
                  marginLeft: -4,
                  height: RULER_HEIGHT_PX,
                }}
                onMouseDown={handlePlayheadDragStart}
                title="Drag to seek"
              />
            </div>
          </div>
        </div>
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

const RemotionPlayerPreview = React.forwardRef<
  PlayerRefType | null,
  { clips: EditorClip[]; durationInFrames: number }
>(function RemotionPlayerPreview({ clips, durationInFrames }, ref) {
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
        ref={ref as React.Ref<PlayerRefType | null>}
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
});

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
  onContextMenu: onContextMenuProp,
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
  onContextMenu?: (e: React.MouseEvent) => void;
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
      onContextMenu={onContextMenuProp}
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
        <span
          className="absolute left-1 right-1 truncate text-[10px] font-medium text-foreground/90"
          title={getClipDisplayName(clip)}
        >
          {getClipDisplayName(clip)}
        </span>
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

function TimelineAudioBlock({
  clip,
  pxPerSec,
  isSelected,
  isDragged,
  onSelect,
  onUpdate,
  onWaveformLoaded,
  onPositionDragStart,
  onContextMenu: onContextMenuProp,
}: {
  clip: EditorClip;
  pxPerSec: number;
  isSelected: boolean;
  isDragged: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<EditorClip>) => void;
  onWaveformLoaded: (data: number[]) => void;
  onPositionDragStart: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [trimDrag, setTrimDrag] = useState<{
    side: "left" | "right";
    startX: number;
    startValue: number;
  } | null>(null);
  const [waveformLoading, setWaveformLoading] = useState(false);

  const trimStart = toFinite(clip.trimStartSec, 0);
  const trimEnd = toFinite(clip.trimEndSec, 10);
  const durationSec = Math.max(0, trimEnd - trimStart);
  const fullDuration = Math.max(durationSec, toFinite(clip.durationSec, trimEnd || 10));
  const minClipWidthPx = Math.max(24, 0.1 * pxPerSec);
  const widthPx = Math.max(
    minClipWidthPx,
    Math.min(fullDuration * pxPerSec, durationSec * pxPerSec)
  );
  const safeWidth = toFinite(widthPx, minClipWidthPx);
  const wrapperWidthPx = Math.max(safeWidth, toFinite(fullDuration * pxPerSec, safeWidth));
  const clipLeftPx =
    fullDuration > 0 ? (trimStart / fullDuration) * wrapperWidthPx : 0;

  const onWaveformLoadedRef = useRef(onWaveformLoaded);
  onWaveformLoadedRef.current = onWaveformLoaded;
  useEffect(() => {
    if (clip.waveformData?.length) return;
    if (waveformLoading) return;
    setWaveformLoading(true);
    decodeAudioWaveform(clip.src)
      .then((data) => {
        onWaveformLoadedRef.current(data);
      })
      .catch(() => {
        onWaveformLoadedRef.current(Array(WAVEFORM_SAMPLES).fill(0.1));
      })
      .finally(() => setWaveformLoading(false));
  }, [clip.id, clip.src, clip.waveformData?.length, waveformLoading]);

  useEffect(() => {
    if (!trimDrag || !barRef.current) return;
    const fullDur = Math.max(fullDuration, 0.1);
    const onMouseMove = (e: MouseEvent) => {
      const rect = barRef.current!.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const sec = Math.max(0, Math.min(1, x)) * fullDur;
      if (trimDrag.side === "left") {
        onUpdate({
          trimStartSec: Math.max(0, Math.min(sec, trimEnd - MIN_TRIM_DURATION_SEC)),
        });
      } else {
        onUpdate({
          trimEndSec: Math.max(
            trimStart + MIN_TRIM_DURATION_SEC,
            Math.min(fullDur, sec)
          ),
        });
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

  const waveform = clip.waveformData ?? [];
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveform.length === 0) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(wrapperWidthPx));
    const ch = Math.max(1, Math.round(rect.height));
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const centerY = ch / 2;
    const barWidth = Math.max(0.5, cw / waveform.length);
    ctx.fillStyle = "rgba(59, 130, 246, 0.7)";
    waveform.forEach((norm, i) => {
      const barH = Math.max(1, norm * (centerY - 2));
      const x = (i / waveform.length) * cw;
      ctx.fillRect(x, centerY - barH, barWidth, barH * 2);
    });
  }, [waveform, wrapperWidthPx]);

  return (
    <div
      ref={barRef}
      role="button"
      tabIndex={0}
      onMouseDown={(e) => {
        if (e.button === 0) onPositionDragStart(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onContextMenu={onContextMenuProp}
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
        <div className="absolute inset-0 bg-foreground/10" />
        {waveformLoading || waveform.length === 0 ? (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-foreground/50">
            {waveformLoading ? "Loading…" : "No waveform"}
          </span>
        ) : (
          <div
            className="absolute top-0 bottom-0 overflow-hidden"
            style={{
              left: -clipLeftPx,
              width: wrapperWidthPx,
              minWidth: wrapperWidthPx,
            }}
          >
            <canvas
              ref={canvasRef}
              className="block h-full"
              style={{ width: `${wrapperWidthPx}px`, height: "100%" }}
            />
          </div>
        )}
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
    </div>
  );
}
