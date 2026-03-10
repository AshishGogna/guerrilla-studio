"use client";

import { renderMediaOnWeb } from "@remotion/web-renderer";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Video } from "@remotion/media";
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import { loadEditorState, saveEditorState } from "@/lib/panels-storage";

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
/** Minimum segment duration (sec) when splitting by silences; shorter segments are skipped to avoid very thin clips. */
const MIN_SEGMENT_DURATION_SEC = 1;
const RULER_HEIGHT_PX = 36; // h-9 in Tailwind
const TIMELINE_PADDING_PX = 16; // p-4 on scroll container

function formatPlayheadTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secPart = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(secPart).padStart(2, "0"),
    String(ms).padStart(3, "0"),
  ].join(":");
}

function hexToRgba(hex: string, alpha: number): string {
  if (hex === TRANSPARENT_VALUE) return "transparent";
  const m = hex.replace(/^#/, "").match(/^([0-9a-f]{6})$/i);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const SUBTITLE_RECOMMENDED_COLORS = [
  "#ffffff", "#000000", "#ffff00", "#00ffff", "#00ff00", "#ff6600",
  "#ff00ff", "#c0c0c0", "#333333", "#1a1a1a", "#ffeb3b", "#e3f2fd",
];

const TRANSPARENT_VALUE = "transparent";

function ColorPickerPopover({
  value,
  onChange,
  onClose,
  anchorRef,
  isOpen,
  allowTransparent,
}: {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  isOpen: boolean;
  allowTransparent?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isTransparent = value === TRANSPARENT_VALUE;
  const normalizedHex = isTransparent ? "#000000" : (value.startsWith("#") ? value : `#${value}`.replace(/^##/, "#"));
  const [hexInput, setHexInput] = useState(isTransparent ? TRANSPARENT_VALUE : normalizedHex);

  useEffect(() => {
    if (!isOpen) return;
    setHexInput(isTransparent ? TRANSPARENT_VALUE : normalizedHex);
  }, [isOpen, isTransparent, normalizedHex]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: MouseEvent) => {
      const el = e.target as Node;
      if (panelRef.current?.contains(el) || anchorRef.current?.contains(el)) return;
      onClose();
    };
    document.addEventListener("mousedown", handle, true);
    return () => document.removeEventListener("mousedown", handle, true);
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  const rect = anchorRef.current?.getBoundingClientRect();
  const style: React.CSSProperties = rect
    ? { position: "fixed", left: rect.left, top: rect.bottom + 4, zIndex: 9999 }
    : {};

  const commitHex = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (allowTransparent && (t === "transparent" || t === "trans")) {
      onChange(TRANSPARENT_VALUE);
      setHexInput(TRANSPARENT_VALUE);
      return;
    }
    const h = t.replace(/^#/, "").trim();
    if (/^[0-9a-fA-F]{6}$/.test(h)) {
      const hex = `#${h}`;
      onChange(hex);
      setHexInput(hex);
    } else {
      setHexInput(value.startsWith("#") ? value : value === TRANSPARENT_VALUE ? TRANSPARENT_VALUE : `#${value}`);
    }
  };

  const recommendedColors = allowTransparent ? [TRANSPARENT_VALUE, ...SUBTITLE_RECOMMENDED_COLORS] : SUBTITLE_RECOMMENDED_COLORS;

  return createPortal(
    <div
      ref={panelRef}
      className="rounded-lg border border-foreground/20 bg-background shadow-xl p-3 min-w-[200px]"
      style={style}
    >
      <div className="flex items-center gap-2 mb-2">
        {!isTransparent && (
          <input
            type="color"
            value={normalizedHex}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v);
              setHexInput(v);
            }}
            className="w-10 h-10 rounded border border-foreground/20 cursor-pointer"
            title="Color wheel"
          />
        )}
        <input
          type="text"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={() => commitHex(hexInput)}
          onKeyDown={(e) => e.key === "Enter" && commitHex(hexInput)}
          className="flex-1 rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm font-mono"
          placeholder={allowTransparent ? "#hex or transparent" : "#ffffff"}
        />
      </div>
      <div className="text-[10px] text-foreground/50 mb-1">Recommended</div>
      <div className="grid grid-cols-6 gap-1">
        {recommendedColors.map((item) =>
          item === TRANSPARENT_VALUE ? (
            <button
              key={TRANSPARENT_VALUE}
              type="button"
              onClick={() => { onChange(TRANSPARENT_VALUE); setHexInput(TRANSPARENT_VALUE); }}
              className="w-6 h-6 rounded border border-foreground/20 hover:ring-2 ring-accent flex items-center justify-center bg-transparent"
              style={{
                backgroundImage: "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
                backgroundSize: "4px 4px",
                backgroundPosition: "0 0, 0 2px, 2px -2px, -2px 0",
              }}
              title="Transparent"
            >
              <span className="text-[8px] text-foreground/60 font-medium">T</span>
            </button>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => { onChange(item); setHexInput(item); }}
              className="w-6 h-6 rounded border border-foreground/20 hover:ring-2 ring-accent"
              style={{ backgroundColor: item }}
              title={item}
            />
          )
        )}
      </div>
    </div>,
    document.body
  );
}

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
  if (clip.fileName) return clip.fileName;
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

export type ClipKind = "video" | "audio" | "combined" | "subtitle";

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
  /** Id of the linked partner clip. Moving one syncs the other. Cleared on Unlink. */
  linkedClipId?: string;
  /** Original file name (for display). */
  fileName?: string;
  /** When true the clip is muted/hidden in the composition but still shown on the timeline. */
  disabled?: boolean;
  /** Subtitle text (for subtitle clips). */
  text?: string;
}

/** Remove one clip from an array and clear partner's linkedClipId. Same logic as removeClip but pure. */
function removeClipFromArray(clips: EditorClip[], idToRemove: string): EditorClip[] {
  const clip = clips.find((c) => c.id === idToRemove);
  const partnerId = clip?.linkedClipId;
  let next = clips.filter((c) => c.id !== idToRemove);
  if (partnerId) {
    next = next.map((c) =>
      c.id === partnerId ? { ...c, linkedClipId: undefined } : c
    );
  }
  return next;
}

const WAVEFORM_SAMPLES = 256;

/** Decode audio from a media URL and return normalized waveform samples. */
async function decodeAudioWaveform(src: string): Promise<number[]> {
  const res = await fetch(src, { mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error(`Waveform fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new Error("Empty audio");
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const audio = await ctx.decodeAudioData(buf);
  ctx.close();
  const ch = audio.getChannelData(0);
  if (!ch || ch.length === 0) throw new Error("No audio channel");
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

export type SubtitleStyle = {
  textSize: number;
  textColor: string;
  backgroundColor: string;
  maxWidth: number;
};

export function EditorCompositionWithProps({
  clips: rawClips = [],
  subtitleStyle,
}: {
  clips?: EditorClip[];
  subtitleStyle?: SubtitleStyle;
}) {
  const { fps } = useVideoConfig();
  const allEnabled = rawClips.filter((c) => !c.disabled);
  const clips = allEnabled.filter((c) => c.kind !== "subtitle");
  const subtitleClips = allEnabled.filter((c) => c.kind === "subtitle");

  if (allEnabled.length === 0) {
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
    ...allEnabled.map((c) => {
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
              const gapEndFrame = Math.round(gap.end * safeFps);
              const durationInFrames = Math.max(1, gapEndFrame - fromFrame);
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

              const isAudioSrc = /\.(mp3|wav|ogg|aac|flac|webm|m4a)(\?|$)/i.test(clip.src) ||
                clip.src.startsWith("blob:");

              const renderClipSequence = (
                trimStart: number,
                trimEnd: number,
                volume: number | ((frame: number) => number),
                isAudioOnly: boolean,
                keySuffix: string
              ) => {
                const durationSec = Math.max(0, trimEnd - trimStart);
                if (durationSec <= 0) return null;
                const clipStart = toFinite(clip.startTimeSec, 0);
                const fromFrame = Math.round(clipStart * safeFps);
                const endFrame = Math.round((clipStart + durationSec) * safeFps);
                const CROSSFADE_FRAMES = 3;
                const durationInFrames = Math.max(1, endFrame - fromFrame + CROSSFADE_FRAMES);
                const trimBefore = Math.max(0, Math.round(trimStart * safeFps));
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

                const useAudioElement = isAudioOnly && (clip.kind === "audio");

                return (
                  <Sequence
                    key={`${clip.id}-${keySuffix}`}
                    from={fromFrame}
                    durationInFrames={durationInFrames}
                    name={`Clip ${clip.id} ${keySuffix}`}
                  >
                    <AbsoluteFill>
                      {useAudioElement ? (
                        <Audio
                          src={clip.src}
                          startFrom={trimBefore}
                          volume={vol}
                        />
                      ) : (
                        <Video
                          src={clip.src}
                          trimBefore={trimBefore}
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
                      )}
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
      {subtitleClips.length > 0 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {subtitleClips.map((sub) => {
            const durSec = Math.max(0, toFinite(sub.trimEndSec, 0) - toFinite(sub.trimStartSec, 0));
            const subStart = toFinite(sub.startTimeSec, 0);
            const fromFrame = Math.round(subStart * safeFps);
            const durationInFrames = Math.max(1, Math.round((subStart + durSec) * safeFps) - fromFrame);
            return (
              <Sequence
                key={sub.id}
                from={fromFrame}
                durationInFrames={durationInFrames}
                name={`Sub ${sub.id}`}
              >
                <AbsoluteFill
                  style={{
                    justifyContent: "flex-end",
                    alignItems: "center",
                    paddingBottom: 40,
                  }}
                >
                  <div
                    style={{
                      backgroundColor: subtitleStyle
                        ? (subtitleStyle.backgroundColor === TRANSPARENT_VALUE
                          ? "transparent"
                          : hexToRgba(subtitleStyle.backgroundColor, 0.7))
                        : "rgba(0,0,0,0.7)",
                      color: subtitleStyle?.textColor ?? "#fff",
                      padding: "6px 16px",
                      borderRadius: 4,
                      fontSize: subtitleStyle?.textSize ?? 24,
                      fontFamily: "sans-serif",
                      textAlign: "center",
                      maxWidth: subtitleStyle?.maxWidth != null ? `${subtitleStyle.maxWidth}%` : "80%",
                    }}
                  >
                    {sub.text}
                  </div>
                </AbsoluteFill>
              </Sequence>
            );
          })}
        </AbsoluteFill>
      )}
    </>
  );
}

const EDITOR_PROJECT_ID = "X";

function isEditorSavePath(src: string): boolean {
  return typeof src === "string" && src.startsWith("/editor-saves/");
}

export default function Editor() {
  const [clips, setClips] = useState<EditorClip[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = loadEditorState(EDITOR_PROJECT_ID).clips as unknown as EditorClip[];
    return raw.filter((c) => !c.src.startsWith("blob:"));
  });
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
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<PlayerRefType | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribingAll, setIsTranscribingAll] = useState(false);
  const [isCuttingSilences, setIsCuttingSilences] = useState(false);
  const [silenceBuffer, setSilenceBuffer] = useState(0.5);
  const [cutSilencesOpen, setCutSilencesOpen] = useState(false);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [subtitleTextSize, setSubtitleTextSize] = useState(24);
  const [subtitleTextColor, setSubtitleTextColor] = useState("#ffffff");
  const [subtitleBgColor, setSubtitleBgColor] = useState("#000000");
  const [subtitleMaxWidth, setSubtitleMaxWidth] = useState(80);
  const [colorPickerOpen, setColorPickerOpen] = useState<null | "text" | "bg">(null);
  const textColorAnchorRef = useRef<HTMLButtonElement>(null);
  const bgColorAnchorRef = useRef<HTMLButtonElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const timelinePxPerSecRef = useRef(timelinePxPerSec);
  timelinePxPerSecRef.current = timelinePxPerSec;
  const skipNextSaveRef = useRef(true);
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || hasHydratedRef.current) return;
    const withPaths = clips.filter((c) => isEditorSavePath(c.src));
    if (withPaths.length === 0) {
      hasHydratedRef.current = true;
      return;
    }
    hasHydratedRef.current = true;
    (async () => {
      const updated = await Promise.all(
        clips.map(async (c): Promise<EditorClip> => {
          if (!isEditorSavePath(c.src)) return c;
          try {
            const base = window.location.origin;
            const res = await fetch(base + c.src);
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            await fetch("/api/editor-delete-save", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: c.src }),
            });
            return { ...c, src: blobUrl };
          } catch {
            return c;
          }
        })
      );
      skipNextSaveRef.current = true;
      setClips(updated);
    })();
  }, []);

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const hasBlob = clips.some((c) => c.src.startsWith("blob:"));
    if (hasBlob) {
      (async () => {
        const updated: EditorClip[] = await Promise.all(
          clips.map(async (c): Promise<EditorClip> => {
            if (!c.src.startsWith("blob:")) return c;
            try {
              const res = await fetch(c.src);
              const blob = await res.blob();
              const form = new FormData();
              form.append("file", blob, c.fileName || `${c.id}.mp4`);
              form.append("projectId", EDITOR_PROJECT_ID);
              form.append("clipId", c.id);
              const r = await fetch("/api/editor-save-blob", {
                method: "POST",
                body: form,
              });
              const data = await r.json();
              if (data.path) return { ...c, src: data.path };
            } catch {
              // ignore
            }
            return c;
          })
        );
        setClips(updated);
        saveEditorState(EDITOR_PROJECT_ID, { clips: updated });
      })();
    } else {
      saveEditorState(EDITOR_PROJECT_ID, { clips });
    }
  }, [clips]);

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
      const videoTrack = 0;
      const audioTrack = 1;
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
        { ...base, id: videoId, trackIndex: videoTrack, kind: "video" as const, linkedClipId: audioId },
        { ...base, id: audioId, trackIndex: audioTrack, kind: "audio" as const, linkedClipId: videoId },
      ];
    });
    setAddUrl("");
  }, []);

  const addAudioClip = useCallback((src: string, fileName?: string) => {
    setClips((prev) => {
      const maxTrack = prev.length === 0
        ? -1
        : Math.max(...prev.map((c) => toFinite(c.trackIndex, 0)));
      const newTrack = maxTrack + 1;
      const id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      return [
        ...prev,
        {
          id,
          src,
          trimStartSec: 0,
          trimEndSec: 10,
          startTimeSec: 0,
          trackIndex: newTrack,
          kind: "audio" as const,
          ...(fileName ? { fileName } : {}),
        },
      ];
    });
  }, []);

  const [isRecordingPaused, setIsRecordingPaused] = useState(false);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    playerRef.current?.pause();
    playerRef.current?.setVolume(1);
    setIsRecording(false);
    setIsRecordingPaused(false);
  }, []);

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.pause();
      playerRef.current?.pause();
      setIsRecordingPaused(true);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "paused") {
      recorder.resume();
      playerRef.current?.play();
      setIsRecordingPaused(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        playerRef.current?.setVolume(1);
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          addAudioClip(url, "Voiceover");
        }
        setIsRecording(false);
      };

      playerRef.current?.seekTo(0);
      playerRef.current?.setVolume(0);
      recorder.start();
      setIsRecording(true);

      setTimeout(() => {
        playerRef.current?.play();
      }, 100);

      const player = playerRef.current;
      if (player) {
        const onEnd = () => {
          if (mediaRecorderRef.current?.state !== "inactive") {
            stopRecording();
          }
          player.removeEventListener("ended", onEnd);
        };
        player.addEventListener("ended", onEnd);
      }
    } catch (err) {
      alert("Could not access microphone: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [addAudioClip, stopRecording]);

  const transcribeClip = useCallback(async (clipId: string) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    setClipContextMenu(null);
    try {
      const res = await fetch(clip.src);
      const blob = await res.blob();
      const formData = new FormData();
      formData.append("audio", blob, clip.fileName ?? "clip.webm");
      const response = await fetch("/api/whisper-clip", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      console.log("Transcription result:", data);

      const segments: { start: number; end: number; text: string }[] = data.segments ?? [];
      if (segments.length === 0) return;

      const clipOffset = toFinite(clip.startTimeSec, 0);

      setClips((prev) => {
        const existingSubTrack = prev.find((c) => c.kind === "subtitle");
        if (existingSubTrack != null) {
          const subTrackIdx = toFinite(existingSubTrack.trackIndex, 0);
          const newSubs: EditorClip[] = segments.map((seg, i) => ({
            id: `sub-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            src: "",
            trimStartSec: 0,
            trimEndSec: seg.end - seg.start,
            durationSec: seg.end - seg.start,
            startTimeSec: clipOffset + seg.start,
            trackIndex: subTrackIdx,
            kind: "subtitle" as const,
            text: seg.text.trim(),
          }));
          return [...prev, ...newSubs];
        }
        const shifted = prev.map((c) => ({ ...c, trackIndex: toFinite(c.trackIndex, 0) + 1 }));
        const subtitleClips: EditorClip[] = segments.map((seg, i) => ({
          id: `sub-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          src: "",
          trimStartSec: 0,
          trimEndSec: seg.end - seg.start,
          durationSec: seg.end - seg.start,
          startTimeSec: clipOffset + seg.start,
          trackIndex: 0,
          kind: "subtitle" as const,
          text: seg.text.trim(),
        }));
        return [...subtitleClips, ...shifted];
      });
    } catch (err) {
      console.error("Transcription failed:", err);
      alert("Transcription failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [clips]);

  const transcribeAll = useCallback(async () => {
    const audioClips = clips.filter(
      (c) => (c.kind === "audio" || c.kind === "combined") && !c.disabled
    );
    if (audioClips.length === 0) return;
    setIsTranscribingAll(true);
    try {
      for (const clip of audioClips) {
        await transcribeClip(clip.id);
      }
    } finally {
      setIsTranscribingAll(false);
    }
  }, [clips, transcribeClip]);

  const transcribeClipRaw = useCallback(async (clip: EditorClip): Promise<{ start: number; end: number; text: string }[]> => {
    try {
      const res = await fetch(clip.src);
      const blob = await res.blob();
      const formData = new FormData();
      formData.append("audio", blob, clip.fileName ?? "clip.webm");
      const response = await fetch("/api/whisper-clip", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      return data.segments ?? [];
    } catch (err) {
      console.error("Transcription failed for clip", clip.id, err);
      return [];
    }
  }, []);

  const detectSilencesForClip = useCallback(async (clip: EditorClip): Promise<{ start: number; end: number }[]> => {
    try {
      const res = await fetch(clip.src);
      const blob = await res.blob();
      const formData = new FormData();
      formData.append("file", blob, clip.fileName ?? "clip.webm");
      const response = await fetch("/api/detect-silences", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      console.log("Silences detected for clip:", clip.id, ":", data.silences);
      return data.silences ?? [];
    } catch (err) {
      console.error("Detect silences failed for clip", clip.id, err);
      return [];
    }
  }, []);

  /** Build content/silence segments from silences within [trimStart, trimEnd]. */
  const buildSegmentsFromSilences = useCallback(
    (trimStart: number, trimEnd: number, silences: { start: number; end: number }[]) => {
      const overlapping = silences
        .filter((s) => s.end > trimStart && s.start < trimEnd)
        .map((s) => ({
          start: Math.max(s.start, trimStart),
          end: Math.min(s.end, trimEnd),
        }))
        .sort((a, b) => a.start - b.start);
      const segments: { start: number; end: number; isSilence: boolean }[] = [];
      let t = trimStart;
      for (const s of overlapping) {
        if (t < s.start) {
          segments.push({ start: t, end: s.start, isSilence: false });
        }
        segments.push({ start: s.start, end: s.end, isSilence: true });
        t = s.end;
      }
      if (t < trimEnd) {
        segments.push({ start: t, end: trimEnd, isSilence: false });
      }
      return segments;
    },
    []
  );

  const cutSilences = useCallback(async () => {
    const audioClips = clips.filter(
      (c) => (c.kind === "audio" || c.kind === "combined") && !c.disabled
    );
    if (audioClips.length === 0) return;
    setIsCuttingSilences(true);
    try {
      // Only process one clip per linked pair (process the one we consider "main").
      const processed = new Set<string>();
      const toProcess: EditorClip[] = [];
      for (const clip of audioClips) {
        const partnerId = clip.linkedClipId;
        if (partnerId && processed.has(partnerId)) continue;
        toProcess.push(clip);
        processed.add(clip.id);
        if (partnerId) processed.add(partnerId);
      }

      const replacementMap = new Map<string, EditorClip[]>();
      for (const clip of toProcess) {
        const silences = await detectSilencesForClip(clip);
        const trimStart = toFinite(clip.trimStartSec, 0);
        const trimEnd = toFinite(clip.trimEndSec, toFinite(clip.durationSec, 10));
        const segments = buildSegmentsFromSilences(trimStart, trimEnd, silences);
        if (segments.length <= 1) continue;

        const partner = clip.linkedClipId ? clips.find((c) => c.id === clip.linkedClipId) : null;
        let timelineSec = toFinite(clip.startTimeSec, 0);

        const segmentClips: EditorClip[] = [];
        const partnerSegmentClips: EditorClip[] = [];

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const segDur = Math.max(0, seg.end - seg.start);
          // Skip very short segments to avoid extra very thin clips (e.g. tiny tail after last silence)
          if (segDur < MIN_SEGMENT_DURATION_SEC) {
            timelineSec += segDur;
            continue;
          }
          const id = `clip-${Date.now()}-${clip.id}-seg-${i}-${Math.random().toString(36).slice(2, 9)}`;
          const partnerId = partner
            ? `clip-${Date.now()}-${partner.id}-seg-${i}-${Math.random().toString(36).slice(2, 9)}`
            : undefined;

          const newClip: EditorClip = {
            ...clip,
            id,
            trimStartSec: seg.start,
            trimEndSec: seg.end,
            startTimeSec: timelineSec,
            disabled: seg.isSilence,
            linkedClipId: partnerId,
          };
          if (clip.kind === "combined") {
            newClip.trimStartSecVideo = seg.start;
            newClip.trimEndSecVideo = seg.end;
            newClip.trimStartSecAudio = seg.start;
            newClip.trimEndSecAudio = seg.end;
          }
          segmentClips.push(newClip);

          if (partner && partnerId) {
            const newPartner: EditorClip = {
              ...partner,
              id: partnerId,
              trimStartSec: seg.start,
              trimEndSec: seg.end,
              startTimeSec: timelineSec,
              disabled: seg.isSilence,
              linkedClipId: id,
            };
            if (partner.kind === "combined") {
              newPartner.trimStartSecVideo = seg.start;
              newPartner.trimEndSecVideo = seg.end;
              newPartner.trimStartSecAudio = seg.start;
              newPartner.trimEndSecAudio = seg.end;
            }
            partnerSegmentClips.push(newPartner);
          }

          timelineSec += segDur;
        }

        if (segmentClips.length > 0) {
          replacementMap.set(clip.id, segmentClips);
          if (partner) replacementMap.set(partner.id, partnerSegmentClips);
        }
      }

      // Build disabled list once from replacementMap (avoids double log from Strict Mode)
      const allSegmentClips = [...replacementMap.values()].flat();
      const disabledClips = allSegmentClips.filter((c) => c.disabled);
      console.log(
        "Cut silences – disabled clips:",
        disabledClips.length,
        "(silence segments × tracks; e.g. 2 silences × video+audio = 4):",
        disabledClips
      );

      setClips((prev) => {
        let next = prev.flatMap((c) => {
          const repl = replacementMap.get(c.id);
          return repl ?? [c];
        });
        // Remove disabled (silence) clips using same logic as removeClip
        const toRemoveIds = next.filter((c) => c.disabled).map((c) => c.id);
        for (const id of toRemoveIds) {
          const clip = next.find((c) => c.id === id);
          if (clip?.src.startsWith("blob:")) URL.revokeObjectURL(clip.src);
          next = removeClipFromArray(next, id);
        }
        // Compact timeline: reassign startTimeSec so no gaps remain
        const nonSub = next.filter((c) => c.kind !== "subtitle");
        if (nonSub.length > 0) {
          const byStart = new Map<number, EditorClip[]>();
          for (const c of nonSub) {
            const t = toFinite(c.startTimeSec, 0);
            if (!byStart.has(t)) byStart.set(t, []);
            byStart.get(t)!.push(c);
          }
          const sortedStarts = [...byStart.keys()].sort((a, b) => a - b);
          const newStartMap = new Map<string, number>();
          let runEnd = 0;
          for (const t of sortedStarts) {
            const group = byStart.get(t)!;
            const maxDur = Math.max(
              ...group.map((c) =>
                Math.max(0, toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0))
              )
            );
            for (const c of group) {
              newStartMap.set(c.id, runEnd);
              if (c.linkedClipId) newStartMap.set(c.linkedClipId, runEnd);
            }
            runEnd += maxDur;
          }
          next = next.map((c) => {
            const newStart = newStartMap.get(c.id);
            if (newStart === undefined) return c;
            return { ...c, startTimeSec: newStart };
          });
        }
        return next;
      });
      playerRef.current?.seekTo(0);
    } finally {
      setIsCuttingSilences(false);
    }
  }, [clips, detectSilencesForClip, buildSegmentsFromSilences]);

  const removeClip = useCallback((id: string) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === id);
      if (clip?.src.startsWith("blob:")) URL.revokeObjectURL(clip.src);
      return removeClipFromArray(prev, id);
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
      if (!clip) return prev;
      if ((clip.kind ?? "combined") === "combined") {
        const videoTrim = getEffectiveTrim(clip, "video");
        const audioTrim = getEffectiveTrim(clip, "audio");
        const videoId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const audioId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        return prev.filter((c) => c.id !== clipId).concat([
          { ...clip, id: videoId, kind: "video" as const, trimStartSec: videoTrim.trimStartSec, trimEndSec: videoTrim.trimEndSec, linkedClipId: undefined },
          { ...clip, id: audioId, kind: "audio" as const, trimStartSec: audioTrim.trimStartSec, trimEndSec: audioTrim.trimEndSec, linkedClipId: undefined },
        ]);
      }
      const partnerId = clip.linkedClipId;
      if (!partnerId) return prev;
      return prev.map((c) =>
        c.id === clipId || c.id === partnerId ? { ...c, linkedClipId: undefined } : c
      );
    });
    setClipContextMenu(null);
    setSelectedClipId(null);
  }, []);

  const toggleClipEnabled = useCallback((clipId: string) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === clipId);
      if (!clip) return prev;
      const newDisabled = !clip.disabled;
      const partnerId = clip.linkedClipId;
      return prev.map((c) =>
        c.id === clipId || (partnerId && c.id === partnerId)
          ? { ...c, disabled: newDisabled }
          : c
      );
    });
    setClipContextMenu(null);
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
        if (file.type.startsWith("audio/")) {
          addAudioClip(url, file.name);
        } else {
          addClip(url);
        }
      }
      e.target.value = "";
    },
    [addClip, addAudioClip]
  );

  const updateClip = useCallback(
    (id: string, patch: Partial<EditorClip>) => {
      setClips((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      );
    },
    []
  );

  /** Update only the trim for the given track (video or audio row). Prevents trimming one row from changing the other.
   *  For linked clips, the same trim change is applied to the partner.
   *  When startTimeSec is in the patch (e.g. when trimming from left), it is applied so the timeline graphic shortens from the left. */
  const updateClipTrimForTrack = useCallback(
    (id: string, patch: { trimStartSec?: number; trimEndSec?: number; startTimeSec?: number }, trackType: "video" | "audio") => {
      setClips((prev) => {
        const target = prev.find((c) => c.id === id);
        if (!target) return prev;
        const k = target.kind ?? "combined";
        const linkedId = target.linkedClipId;

        return prev.map((c) => {
          const isTarget = c.id === id;
          const isLinked = linkedId != null && c.id === linkedId;
          if (!isTarget && !isLinked) return c;

          const startPatch = patch.startTimeSec != null ? { startTimeSec: patch.startTimeSec } : {};

          if (k === "combined" && isTarget) {
            if (trackType === "video") {
              return {
                ...c,
                ...startPatch,
                ...(patch.trimStartSec != null && { trimStartSecVideo: patch.trimStartSec }),
                ...(patch.trimEndSec != null && { trimEndSecVideo: patch.trimEndSec }),
              };
            }
            return {
              ...c,
              ...startPatch,
              ...(patch.trimStartSec != null && { trimStartSecAudio: patch.trimStartSec }),
              ...(patch.trimEndSec != null && { trimEndSecAudio: patch.trimEndSec }),
            };
          }

          return { ...c, ...startPatch, ...patch };
        });
      });
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
        if (delta <= 0) return next;
        return next.map((c) =>
          c.id === clipId
            ? c
            : toFinite(c.startTimeSec, 0) >= oldEnd
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

      const partnerId = a.linkedClipId;

      let next = prevClips.map((c) => {
        if (c.id === movedId) return { ...c, startTimeSec: aStart, trackIndex: aTrack };
        if (partnerId && c.id === partnerId) return { ...c, startTimeSec: aStart };
        return { ...c };
      });

      const skipIds = new Set<string>([movedId]);
      if (partnerId) skipIds.add(partnerId);

      const resolveOverlaps = (
        clips: EditorClip[],
        anchorStart: number,
        anchorEnd: number,
        anchorTrack: number
      ): EditorClip[] =>
        clips.map((b) => {
          if (skipIds.has(b.id)) return b;
          if (toFinite(b.trackIndex, 0) !== anchorTrack) return b;
          const bStart = toFinite(b.startTimeSec, 0);
          const bDur = Math.max(0, toFinite(b.trimEndSec, 0) - toFinite(b.trimStartSec, 0));
          const bEnd = bStart + bDur;
          if (anchorEnd <= bStart || anchorStart >= bEnd) return b;

          const bTrimStart = toFinite(b.trimStartSec, 0);
          const bTrimEnd = toFinite(b.trimEndSec, 0);

          if (anchorEnd > bStart && anchorEnd < bEnd && anchorStart <= bStart) {
            const trimOff = anchorEnd - bStart;
            return {
              ...b,
              startTimeSec: anchorEnd,
              trimStartSec: Math.min(bTrimEnd - MIN_TRIM_DURATION_SEC, bTrimStart + trimOff),
            };
          }
          if (anchorStart > bStart && anchorStart < bEnd && anchorEnd >= bEnd) {
            const newDur = anchorStart - bStart;
            return {
              ...b,
              trimEndSec: Math.max(bTrimStart + MIN_TRIM_DURATION_SEC, bTrimStart + newDur),
            };
          }
          if (anchorStart <= bStart && anchorEnd >= bEnd) {
            return { ...b, trimEndSec: bTrimStart };
          }
          if (bStart < anchorStart && bEnd > anchorEnd) {
            return {
              ...b,
              trimEndSec: Math.max(
                bTrimStart + MIN_TRIM_DURATION_SEC,
                bTrimStart + (anchorStart - bStart)
              ),
            };
          }
          if (anchorStart < bEnd && anchorEnd > bStart && anchorStart > bStart) {
            const newDur = anchorStart - bStart;
            return {
              ...b,
              trimEndSec: Math.max(bTrimStart + MIN_TRIM_DURATION_SEC, bTrimStart + newDur),
            };
          }
          if (anchorEnd > bStart && anchorEnd < bEnd) {
            const trimOff = anchorEnd - bStart;
            return {
              ...b,
              startTimeSec: anchorEnd,
              trimStartSec: Math.min(bTrimEnd - MIN_TRIM_DURATION_SEC, bTrimStart + trimOff),
            };
          }
          return b;
        });

      next = resolveOverlaps(next, aStart, aEnd, aTrack);

      if (partnerId) {
        const partner = next.find((c) => c.id === partnerId);
        if (partner) {
          const pTrack = toFinite(partner.trackIndex, 0);
          if (pTrack !== aTrack) {
            const pDur = Math.max(
              0,
              toFinite(partner.trimEndSec, 0) - toFinite(partner.trimStartSec, 0)
            );
            const pStart = toFinite(partner.startTimeSec, 0);
            const pEnd = pStart + pDur;
            next = resolveOverlaps(next, pStart, pEnd, pTrack);
          }
        }
      }

      next = next.map((c) => {
        if (!c.linkedClipId || skipIds.has(c.id)) return c;
        const partner = next.find((x) => x.id === c.linkedClipId);
        if (!partner) return c;
        const orig = prevClips.find((x) => x.id === c.id);
        if (!orig) return c;
        const wasModified =
          toFinite(c.startTimeSec, 0) !== toFinite(orig.startTimeSec, 0) ||
          toFinite(c.trimStartSec, 0) !== toFinite(orig.trimStartSec, 0) ||
          toFinite(c.trimEndSec, 0) !== toFinite(orig.trimEndSec, 0);
        if (wasModified) return c;
        return {
          ...c,
          startTimeSec: toFinite(partner.startTimeSec, 0),
          trimStartSec: toFinite(partner.trimStartSec, 0),
          trimEndSec: toFinite(partner.trimEndSec, 0),
        };
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
        setClips((prev) => {
          const moved = prev.find((c) => c.id === id);
          const partnerId = moved?.linkedClipId;
          return prev.map((c) => {
            if (c.id === id) return { ...c, startTimeSec: newStartSec, trackIndex: currentTrackIndex };
            if (partnerId && c.id === partnerId) return { ...c, startTimeSec: newStartSec };
            return c;
          });
        });
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
          inputProps: {
            clips,
            subtitleStyle: {
              textSize: subtitleTextSize,
              textColor: subtitleTextColor,
              backgroundColor: subtitleBgColor,
              maxWidth: subtitleMaxWidth,
            },
          },
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
    [clips, durationInFrames, subtitleTextSize, subtitleTextColor, subtitleBgColor, subtitleMaxWidth]
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
      {/* Preview + Right Panel */}
      <div className="flex shrink-0 border-b border-foreground/10 bg-black/40" style={{ height: 300 }}>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg bg-black">
            <RemotionPlayerPreview
              ref={playerRef}
              clips={clips}
              durationInFrames={durationInFrames}
              subtitleStyle={{
                textSize: subtitleTextSize,
                textColor: subtitleTextColor,
                backgroundColor: subtitleBgColor,
                maxWidth: subtitleMaxWidth,
              }}
            />
          </div>
        </div>
        {/* AI Tools Panel */}
        <div className="w-64 shrink-0 border-l border-foreground/10 overflow-y-auto bg-foreground/[0.02]">
          <div className="border-b border-foreground/10">
            <button
              type="button"
              onClick={() => setTranscribeOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-foreground/5"
            >
              Transcribe
              <span className="text-xs text-foreground/40">{transcribeOpen ? "▾" : "▸"}</span>
            </button>
            {transcribeOpen && (
              <div className="flex flex-col gap-3 px-3 pb-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Font size</span>
                  <input
                    type="number"
                    min={8}
                    max={120}
                    value={subtitleTextSize}
                    onChange={(e) => setSubtitleTextSize(Math.max(8, Math.min(120, parseInt(e.target.value, 10) || 24)))}
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Text color</span>
                  <button
                    ref={textColorAnchorRef}
                    type="button"
                    onClick={() => setColorPickerOpen((v) => (v === "text" ? null : "text"))}
                    className="flex items-center gap-2 rounded border border-foreground/20 bg-foreground/5 px-2 py-1.5 text-sm hover:bg-foreground/10"
                  >
                    <span className="w-5 h-5 rounded border border-foreground/30 shrink-0" style={{ backgroundColor: subtitleTextColor }} />
                    <span className="font-mono text-xs">{subtitleTextColor}</span>
                  </button>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Background color</span>
                  <button
                    ref={bgColorAnchorRef}
                    type="button"
                    onClick={() => setColorPickerOpen((v) => (v === "bg" ? null : "bg"))}
                    className="flex items-center gap-2 rounded border border-foreground/20 bg-foreground/5 px-2 py-1.5 text-sm hover:bg-foreground/10"
                  >
                    {subtitleBgColor === TRANSPARENT_VALUE ? (
                      <>
                        <span
                          className="w-5 h-5 rounded border border-foreground/30 shrink-0"
                          style={{
                            backgroundImage: "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
                            backgroundSize: "4px 4px",
                            backgroundPosition: "0 0, 0 2px, 2px -2px, -2px 0",
                          }}
                        />
                        <span className="font-mono text-xs">Transparent</span>
                      </>
                    ) : (
                      <>
                        <span className="w-5 h-5 rounded border border-foreground/30 shrink-0" style={{ backgroundColor: subtitleBgColor }} />
                        <span className="font-mono text-xs">{subtitleBgColor}</span>
                      </>
                    )}
                  </button>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Max width (%)</span>
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={subtitleMaxWidth}
                    onChange={(e) => setSubtitleMaxWidth(Math.max(10, Math.min(100, parseInt(e.target.value, 10) || 80)))}
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <ColorPickerPopover
                  isOpen={colorPickerOpen === "text"}
                  value={subtitleTextColor}
                  onChange={setSubtitleTextColor}
                  onClose={() => setColorPickerOpen(null)}
                  anchorRef={textColorAnchorRef}
                />
                <ColorPickerPopover
                  isOpen={colorPickerOpen === "bg"}
                  value={subtitleBgColor}
                  onChange={setSubtitleBgColor}
                  onClose={() => setColorPickerOpen(null)}
                  anchorRef={bgColorAnchorRef}
                  allowTransparent
                />
                <button
                  type="button"
                  onClick={transcribeAll}
                  disabled={isTranscribingAll || clips.filter((c) => (c.kind === "audio" || c.kind === "combined") && !c.disabled).length === 0}
                  className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isTranscribingAll ? "Transcribing..." : "Transcribe all"}
                </button>
              </div>
            )}
          </div>
          <div className="border-b border-foreground/10">
            <button
              type="button"
              onClick={() => setCutSilencesOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-foreground/5"
            >
              Cut Silences
              <span className="text-xs text-foreground/40">{cutSilencesOpen ? "▾" : "▸"}</span>
            </button>
            {cutSilencesOpen && (
              <div className="flex flex-col gap-3 px-3 pb-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Buffer (seconds)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={silenceBuffer}
                    onChange={(e) => setSilenceBuffer(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <button
                  type="button"
                  onClick={cutSilences}
                  disabled={isCuttingSilences || clips.filter((c) => (c.kind === "audio" || c.kind === "combined") && !c.disabled).length === 0}
                  className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isCuttingSilences ? "Cutting..." : "Cut"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex flex-1 flex-col overflow-hidden border-t border-foreground/10" style={{ height: 600 }}>
        <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground/80">Timeline</span>
            <span className="font-mono text-sm tabular-nums text-foreground/70" title="Playhead position">
              {formatPlayheadTime(playheadTimeSec)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*"
              multiple
              className="hidden"
              onChange={handleUploadClips}
            />
            <input
              ref={audioFileInputRef}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={handleUploadClips}
            />
            {isRecording ? (
              <>
                <button
                  type="button"
                  onClick={isRecordingPaused ? resumeRecording : pauseRecording}
                  className="rounded border border-yellow-500 bg-yellow-500/20 text-yellow-400 px-3 py-1.5 text-sm hover:bg-yellow-500/30"
                >
                  {isRecordingPaused ? "▶ Resume" : "⏸ Pause"}
                </button>
                <button
                  type="button"
                  onClick={stopRecording}
                  className="rounded border border-red-500 bg-red-500/20 text-red-400 px-3 py-1.5 text-sm hover:bg-red-500/30"
                >
                  ⏹ Stop
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20"
              >
                ⏺ Record
              </button>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20"
            >
              Upload clips
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
            <button
              type="button"
              onClick={async () => {
                if (clips.length === 0) return;
                if (!confirm("Clear all clips and delete saved state? This cannot be undone.")) return;
                clips.forEach((c) => {
                  if (c.src.startsWith("blob:")) URL.revokeObjectURL(c.src);
                });
                setClips([]);
                setSelectedClipId(null);
                setPlayheadTimeSec(0);
                playerRef.current?.seekTo(0);
                saveEditorState(EDITOR_PROJECT_ID, { clips: [] });
                try {
                  await fetch("/api/editor-clear-saves", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId: EDITOR_PROJECT_ID }),
                  });
                } catch {
                  // ignore
                }
              }}
              disabled={clips.length === 0}
              className="rounded border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear All
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
                        const displayClipV = { ...clip, ...getEffectiveTrim(clip, "video") } as EditorClip;
                        const displayClipA = { ...clip, ...getEffectiveTrim(clip, "audio") } as EditorClip;
                        const trimOffset = k === "audio"
                          ? toFinite(displayClipA.trimStartSec, 0)
                          : toFinite(displayClipV.trimStartSec, 0);
                        const slotLeft = `${((clip.startTimeSec ?? 0) - trimOffset) * timelinePxPerSec}px`;
                        const clipOpacity = clip.disabled ? 0.35 : 1;
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
                              style={{ left: slotLeft, width: `${slotW}px`, pointerEvents: "none", opacity: clipOpacity }}
                            >
                              <div className="h-1/2 min-h-0 overflow-hidden">
                                <TimelineClipBlock
                                  clip={displayClipV}
                                  pxPerSec={timelinePxPerSec}
                                  isSelected={selectedClipId === clip.id || (clip.linkedClipId != null && selectedClipId === clip.linkedClipId)}
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
                                  isSelected={selectedClipId === clip.id || (clip.linkedClipId != null && selectedClipId === clip.linkedClipId)}
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
                        if (k === "subtitle") {
                          const subDur = Math.max(0, toFinite(clip.trimEndSec, 0) - toFinite(clip.trimStartSec, 0));
                          const subWidthPx = Math.max(24, subDur * timelinePxPerSec);
                          const subLeft = `${(clip.startTimeSec ?? 0) * timelinePxPerSec}px`;
                          return (
                            <div
                              key={clip.id}
                              className="absolute top-0 h-full"
                              style={{ left: subLeft, pointerEvents: "none", opacity: clipOpacity }}
                            >
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id); }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setClipContextMenu({ clipId: clip.id, x: e.clientX, y: e.clientY });
                                }}
                                onMouseDown={(e) => {
                                  if (e.button === 0)
                                    handlePositionDragStart(
                                      clip.id,
                                      clip.startTimeSec ?? 0,
                                      toFinite(clip.trackIndex, 0),
                                      e.nativeEvent.clientX,
                                      () => setSelectedClipId(clip.id)
                                    );
                                }}
                                className={`relative h-12 shrink-0 cursor-grab active:cursor-grabbing overflow-hidden rounded border-2 transition ${
                                  selectedClipId === clip.id
                                    ? "border-accent"
                                    : "border-green-500/40 hover:border-green-500/60"
                                } ${draggedId === clip.id ? "opacity-50" : ""}`}
                                style={{ width: `${subWidthPx}px`, pointerEvents: "auto" }}
                              >
                                <div className="absolute inset-0 bg-green-500/15" />
                                <span className="absolute left-1 right-1 top-1/2 -translate-y-1/2 truncate text-[10px] font-medium text-green-300">
                                  {clip.text}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        if (k === "audio") {
                          return (
                            <div key={clip.id} className="absolute top-0 h-full" style={{ left: slotLeft, pointerEvents: "none", opacity: clipOpacity }}>
                              <TimelineAudioBlock
                                clip={displayClipA}
                                pxPerSec={timelinePxPerSec}
                                isSelected={selectedClipId === clip.id || (clip.linkedClipId != null && selectedClipId === clip.linkedClipId)}
                                isDragged={draggedId === clip.id}
                                onSelect={() => setSelectedClipId(clip.id)}
                                onWaveformLoaded={(data) =>
                                  updateClip(clip.id, { waveformData: data })
                                }
                                onMetadataLoaded={!clip.linkedClipId ? (durationSec) =>
                                  handleClipMetadataLoaded(clip.id, durationSec)
                                : undefined}
                                {...blockHandlers(clip, "audio")}
                              />
                            </div>
                          );
                        }
                        return (
                          <div key={clip.id} className="absolute top-0 h-full" style={{ left: slotLeft, pointerEvents: "none", opacity: clipOpacity }}>
                            <TimelineClipBlock
                              clip={displayClipV}
                              pxPerSec={timelinePxPerSec}
                              isSelected={selectedClipId === clip.id || (clip.linkedClipId != null && selectedClipId === clip.linkedClipId)}
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
                  const canUnlink = clip && ((clip.kind ?? "combined") === "combined" || clip.linkedClipId != null);
                  const isDisabled = clip?.disabled;
                  const isAudioClip = clip && ((clip.kind ?? "combined") === "audio" || (clip.kind ?? "combined") === "combined");
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
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-foreground/10"
                        onClick={() => toggleClipEnabled(clipContextMenu.clipId)}
                      >
                        {isDisabled ? "Enable clip" : "Disable clip"}
                      </button>
                      <button
                        type="button"
                        disabled={!canUnlink}
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => unlinkClip(clipContextMenu.clipId)}
                      >
                        Unlink
                      </button>
                      {isAudioClip && (
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-left text-sm hover:bg-foreground/10"
                          onClick={() => transcribeClip(clipContextMenu.clipId)}
                        >
                          Transcribe
                        </button>
                      )}
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
  { clips: EditorClip[]; durationInFrames: number; subtitleStyle?: SubtitleStyle }
>(function RemotionPlayerPreview({ clips, durationInFrames, subtitleStyle }, ref) {
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
        inputProps={{ clips, subtitleStyle }}
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
        const delta = newStart - trimStart;
        const newStartTimeSec = toFinite(clip.startTimeSec, 0) + delta;
        onUpdate({ trimStartSec: newStart, startTimeSec: newStartTimeSec });
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
      className="relative h-12 shrink-0"
      style={{ width: `${Math.max(1, wrapperWidthPx)}px`, pointerEvents: "none" }}
    >
      <div
        role="button"
        tabIndex={0}
        onMouseDown={(e) => {
          if (e.button === 0) onPositionDragStart(e);
        }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={onContextMenuProp}
        className={`absolute top-0 bottom-0 flex items-center overflow-hidden rounded border-2 cursor-grab active:cursor-grabbing transition ${
          isSelected
            ? "border-accent"
            : "border-foreground/20 hover:border-foreground/30"
        } ${isDragged ? "opacity-50" : ""}`}
        style={{
          left: `${clipLeftPx}px`,
          width: `${Math.max(1, safeWidth)}px`,
          pointerEvents: "auto",
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
  onMetadataLoaded,
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
  onMetadataLoaded?: (durationSec: number) => void;
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
  const decodedForSrcRef = useRef<string | null>(null);
  const loadingForSrcRef = useRef<string | null>(null);
  useEffect(() => {
    if (clip.waveformData?.length && decodedForSrcRef.current === clip.src) return;
    if (clip.waveformData?.length) {
      decodedForSrcRef.current = clip.src;
      return;
    }
    if (waveformLoading && loadingForSrcRef.current === clip.src) return;
    const srcToDecode = clip.src;
    loadingForSrcRef.current = srcToDecode;
    let cancelled = false;
    setWaveformLoading(true);
    decodeAudioWaveform(srcToDecode)
      .then((data) => {
        if (cancelled) return;
        decodedForSrcRef.current = srcToDecode;
        onWaveformLoadedRef.current(data);
      })
      .catch(() => {
        if (cancelled) return;
        decodedForSrcRef.current = srcToDecode;
        onWaveformLoadedRef.current(Array(WAVEFORM_SAMPLES).fill(0.1));
      })
      .finally(() => {
        if (!cancelled) setWaveformLoading(false);
        if (!cancelled) loadingForSrcRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [clip.id, clip.src, clip.waveformData?.length]);

  useEffect(() => {
    if (!trimDrag || !barRef.current) return;
    const fullDur = Math.max(fullDuration, 0.1);
    const onMouseMove = (e: MouseEvent) => {
      const rect = barRef.current!.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const sec = Math.max(0, Math.min(1, x)) * fullDur;
      if (trimDrag.side === "left") {
        const newStart = Math.max(0, Math.min(sec, trimEnd - MIN_TRIM_DURATION_SEC));
        const delta = newStart - trimStart;
        const newStartTimeSec = toFinite(clip.startTimeSec, 0) + delta;
        onUpdate({
          trimStartSec: newStart,
          startTimeSec: newStartTimeSec,
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
      className="relative h-12 shrink-0"
      style={{ width: `${Math.max(1, wrapperWidthPx)}px`, pointerEvents: "none" }}
    >
      <div
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
        className={`absolute top-0 bottom-0 flex items-center overflow-hidden rounded border-2 cursor-grab active:cursor-grabbing transition ${
          isSelected
            ? "border-accent"
            : "border-foreground/20 hover:border-foreground/30"
        } ${isDragged ? "opacity-50" : ""}`}
        style={{
          left: `${clipLeftPx}px`,
          width: `${Math.max(1, safeWidth)}px`,
          pointerEvents: "auto",
        }}
      >
        <div className="absolute inset-0 bg-foreground/10" />
        {waveform.length === 0 ? (
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
      {onMetadataLoaded && (
        <audio
          src={clip.src}
          className="hidden"
          preload="metadata"
          onLoadedMetadata={(e) => {
            const el = e.target as HTMLAudioElement;
            const d = toFinite(el.duration, 0);
            if (d > 0) onMetadataLoaded(d);
          }}
        />
      )}
    </div>
  );
}
