"use client";

import { renderMediaOnWeb } from "@remotion/web-renderer";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { addData } from "@/lib/data";
import {
  loadEditorState,
  loadEditorSubtitleSettings,
  loadEditorTransformSettings,
  saveEditorState,
  saveEditorSubtitleSettings,
  saveEditorTransformSettings,
} from "@/lib/panels-storage";
import { getEditorNodeMediaFiles, isAudioFile } from "@/lib/editorNodeFolderSource";
import { EDITOR_NODE_PLAY_EVENT, type EditorNodePlayDetail } from "@/lib/editorNodePlayEvent";

const RemotionPlayer = dynamic(
  () =>
    import("@remotion/player").then((mod) => mod.Player),
  { ssr: false }
);

type PlayerRefType = import("@remotion/player").PlayerRef;

const FPS = 30;
const COMP_WIDTH = 1920;
const COMP_HEIGHT = 1080;
/** Max on-screen preview box; composition aspect ratio (Transform resolution) is preserved inside. */
const PREVIEW_DISPLAY_MAX_W = 960;
const PREVIEW_DISPLAY_MAX_H = 540;
const CLIP_WIDTH_PX_PER_SEC = 64;
const TRACK_HEIGHT_PX = 48;
/** Minimum segment duration (sec) when splitting by silences; shorter segments are skipped to avoid very thin clips. */
const MIN_SEGMENT_DURATION_SEC = 1;
const RULER_HEIGHT_PX = 36; // h-9 in Tailwind
const TIMELINE_PADDING_PX = 16; // p-4 on scroll container

/** Avoid 10k+ DOM nodes on long timelines (hurts drag/render). */
const RULER_MAX_TICKS = 500;

function buildRulerTicks(totalSec: number): { sec: number; isMajor: boolean }[] {
  if (totalSec <= 0) return [{ sec: 0, isMajor: true }];
  let step = 0.25;
  if (totalSec > 90) step = 1;
  if (totalSec > 600) step = 5;
  if (totalSec > 1800) step = 15;
  if (totalSec > 7200) step = 60;
  while (totalSec / step > RULER_MAX_TICKS) {
    step *= 2;
  }
  const ticks: { sec: number; isMajor: boolean }[] = [];
  const count = Math.min(RULER_MAX_TICKS + 1, Math.ceil(totalSec / step) + 1);
  let lastSec = -1;
  for (let i = 0; i <= count; i++) {
    const sec = Math.min(totalSec, Math.round(i * step * 1000) / 1000);
    if (sec <= lastSec) continue;
    lastSec = sec;
    const isMajor = Math.abs(sec - Math.round(sec)) < 0.001;
    ticks.push({ sec, isMajor });
  }
  return ticks;
}

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

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const out = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(out);
  let offset = 0;

  const writeU16 = (v: number) => {
    view.setUint16(offset, v, true);
    offset += 2;
  };
  const writeU32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };

  writeStr("RIFF");
  writeU32(36 + dataSize);
  writeStr("WAVE");
  writeStr("fmt ");
  writeU32(16);
  writeU16(1);
  writeU16(numChannels);
  writeU32(sampleRate);
  writeU32(byteRate);
  writeU16(blockAlign);
  writeU16(16);
  writeStr("data");
  writeU32(dataSize);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i] ?? 0;
      sample = Math.max(-1, Math.min(1, sample));
      const s = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(s), true);
      offset += 2;
    }
  }

  return new Blob([out], { type: "audio/wav" });
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

/** Playback speed (1 = normal). Affects timeline duration as sourceDuration / speed. */
export function clipPlaybackSpeed(clip: EditorClip, globalFallback?: number): number {
  const s = clip.playbackSpeed;
  if (s != null && Number.isFinite(s) && s > 0.01) return Math.min(s, 100);
  const g = globalFallback;
  if (g != null && Number.isFinite(g) && g > 0.01) return Math.min(g, 100);
  return 1;
}

/** Latest timeline end time (seconds) among clips on a given track. */
function getMaxEndOnTrack(
  clipList: EditorClip[],
  trackIndex: number,
  globalSpeedNum: number
): number {
  let maxEnd = 0;
  for (const c of clipList) {
    if (toFinite(c.trackIndex, 0) !== trackIndex) continue;
    const end =
      toFinite(c.startTimeSec, 0) + clipTimelineDurationForTotal(c, globalSpeedNum);
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

/** Timeline duration (seconds) for a media clip’s current trim; subtitles/text ignore speed. */
export function clipTimelineDurationForTotal(clip: EditorClip, globalFallback?: number): number {
  const k = clip.kind ?? "combined";
  if (k === "subtitle" || k === "text") {
    return Math.max(0, toFinite(clip.trimEndSec, 0) - toFinite(clip.trimStartSec, 0));
  }
  if (k === "combined") {
    const v = getEffectiveTrim(clip, "video");
    const src = Math.max(0, v.trimEndSec - v.trimStartSec);
    return src / clipPlaybackSpeed(clip, globalFallback);
  }
  const src = Math.max(0, toFinite(clip.trimEndSec, 0) - toFinite(clip.trimStartSec, 0));
  return src / clipPlaybackSpeed(clip, globalFallback);
}

const MIN_TRIM_DURATION_SEC = 0.1;

/** Timeline Δt → source trim Δ for overlap / split math. */
function timelineDeltaToSource(clip: EditorClip, dtTimeline: number, globalFallback?: number): number {
  return dtTimeline * clipPlaybackSpeed(clip, globalFallback);
}

/** Increase trim start(s) by ds seconds of source media (combined: video + audio). */
function patchTrimStartBySourceDelta(b: EditorClip, ds: number): EditorClip {
  const minGap = MIN_TRIM_DURATION_SEC;
  const k = b.kind ?? "combined";
  if (k === "combined") {
    const v = getEffectiveTrim(b, "video");
    const au = getEffectiveTrim(b, "audio");
    const nv = Math.min(v.trimEndSec - minGap, v.trimStartSec + ds);
    const na = Math.min(au.trimEndSec - minGap, au.trimStartSec + ds);
    const baseT0 = toFinite(b.trimStartSec, 0);
    const baseT1 = toFinite(b.trimEndSec, 0);
    return {
      ...b,
      trimStartSecVideo: nv,
      trimStartSecAudio: na,
      trimStartSec: Math.min(baseT1 - minGap, baseT0 + ds),
    };
  }
  const t0 = toFinite(b.trimStartSec, 0);
  const t1 = toFinite(b.trimEndSec, 0);
  return { ...b, trimStartSec: Math.min(t1 - minGap, t0 + ds) };
}

/** Set trim end so timeline span from clip start equals newDurTimeline (combined: both tracks). */
function patchTrimEndFromTimelineSpan(
  b: EditorClip,
  bStart: number,
  anchorStart: number,
  globalFallback?: number
): EditorClip {
  const newDurT = anchorStart - bStart;
  const ds = timelineDeltaToSource(b, newDurT, globalFallback);
  const minGap = MIN_TRIM_DURATION_SEC;
  const k = b.kind ?? "combined";
  if (k === "combined") {
    const v = getEffectiveTrim(b, "video");
    const au = getEffectiveTrim(b, "audio");
    return {
      ...b,
      trimEndSecVideo: Math.max(v.trimStartSec + minGap, v.trimStartSec + ds),
      trimEndSecAudio: Math.max(au.trimStartSec + minGap, au.trimStartSec + ds),
      trimEndSec: Math.max(
        toFinite(b.trimStartSec, 0) + minGap,
        toFinite(b.trimStartSec, 0) + ds
      ),
    };
  }
  const t0 = toFinite(b.trimStartSec, 0);
  return { ...b, trimEndSec: Math.max(t0 + minGap, t0 + ds) };
}

function patchTrimZeroLength(b: EditorClip): EditorClip {
  if ((b.kind ?? "combined") === "combined") {
    const v = getEffectiveTrim(b, "video");
    const au = getEffectiveTrim(b, "audio");
    return {
      ...b,
      trimEndSecVideo: v.trimStartSec,
      trimEndSecAudio: au.trimStartSec,
      trimEndSec: toFinite(b.trimStartSec, 0),
    };
  }
  return { ...b, trimEndSec: toFinite(b.trimStartSec, 0) };
}

/** Get a short display name for a clip from its src (filename or fallback). */
function getClipDisplayName(clip: EditorClip): string {
  if (clip.kind === "text" && clip.text) {
    return clip.text.length > 40 ? clip.text.slice(0, 37) + "…" : clip.text;
  }
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

export type ClipKind = "video" | "audio" | "combined" | "subtitle" | "text";

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
  /** Word-level timing for karaoke highlight: seconds relative to this clip’s Sequence (0 = clip start). */
  words?: { start: number; end: number; text: string }[];
  /** Per-subtitle styling when `kind === "subtitle"`; merged on top of global Transcribe settings. */
  subtitleStyle?: Partial<SubtitleStyle>;
  /** Font family for text clips. */
  fontFamily?: string;
  /** Font size in px for text clips. */
  textSize?: number;
  /** Text color (hex) for text clips. */
  textColor?: string;
  /** Background color (hex or transparent) for text clips. */
  textBgColor?: string;
  /** Horizontal position in px for text clips. */
  textPositionX?: number;
  /** Vertical position in px for text clips. */
  textPositionY?: number;
  /** Max width in px for text clips. */
  textWidth?: number;
  /** Volume 0–1 for audio/combined clips. */
  volume?: number;
  /** Preview scale for video / combined clips (falls back to global Transform zoom when unset). */
  videoZoom?: number;
  /** Horizontal offset in composition px (video / combined preview). */
  videoPositionX?: number;
  /** Vertical offset in composition px (video / combined preview). */
  videoPositionY?: number;
  /** Playback speed for video / audio / combined (1 = normal). Timeline duration = source trim length / speed. */
  playbackSpeed?: number;
}

/** Apply style/content patch to text clips: single clip when `onlyTextClipId` is set, else all text clips. */
function applyTextClipStylePatch(
  prev: EditorClip[],
  patch: Partial<EditorClip>,
  onlyTextClipId: string | null
): EditorClip[] {
  return prev.map((c) => {
    if (c.kind !== "text") return c;
    if (onlyTextClipId != null) {
      return c.id === onlyTextClipId ? { ...c, ...patch } : c;
    }
    return { ...c, ...patch };
  });
}

function newEditorClipId(): string {
  return `clip-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Save a file under public/editor-saves; returns `/editor-saves/...` or null. */
async function persistEditorFileToServer(
  projectId: string,
  clipId: string,
  file: File
): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", file, file.name || `${clipId}.bin`);
    form.append("projectId", projectId);
    form.append("clipId", clipId);
    const r = await fetch("/api/editor-save-blob", { method: "POST", body: form });
    if (!r.ok) return null;
    const data = (await r.json()) as { path?: string };
    return typeof data.path === "string" ? data.path : null;
  } catch {
    return null;
  }
}

/** Clips to copy: selection + linked partner on another track, if any. */
function collectClipsToDuplicate(clips: EditorClip[], selectedId: string): EditorClip[] {
  const clip = clips.find((c) => c.id === selectedId);
  if (!clip) return [];
  const out: EditorClip[] = [clip];
  if (clip.linkedClipId) {
    const p = clips.find((c) => c.id === clip.linkedClipId);
    if (p && !out.some((x) => x.id === p.id)) out.push(p);
  }
  return out;
}

/** New clips with fresh ids, same tracks as originals, shared start after the last clip ends on each involved track. */
function duplicateClipsForPaste(
  originals: EditorClip[],
  existingClips: EditorClip[],
  globalSpeedNum: number
): EditorClip[] {
  const idMap = new Map<string, string>();
  for (const c of originals) {
    idMap.set(c.id, newEditorClipId());
  }
  const trackIndices = [...new Set(originals.map((c) => toFinite(c.trackIndex, 0)))];
  const pasteStart = Math.max(
    0,
    ...trackIndices.map((t) => getMaxEndOnTrack(existingClips, t, globalSpeedNum))
  );
  return originals.map((c) => {
    const newId = idMap.get(c.id)!;
    let linked: string | undefined;
    if (c.linkedClipId) {
      const mapped = idMap.get(c.linkedClipId);
      if (mapped) linked = mapped;
    }
    return {
      ...c,
      id: newId,
      startTimeSec: pasteStart,
      linkedClipId: linked,
    };
  });
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

/**
 * Many clips can share the same blob: URL (e.g. cut-silence segments, linked video+audio).
 * Only revoke after removal when no remaining clip still references that URL.
 */
function revokeBlobSrcIfOrphaned(remainingClips: EditorClip[], src: string): void {
  if (!src.startsWith("blob:")) return;
  if (remainingClips.some((c) => c.src === src)) return;
  try {
    URL.revokeObjectURL(src);
  } catch {
    // ignore
  }
}

const WAVEFORM_SAMPLES = 256;
/** Stable empty waveform for clips not yet decoded (avoids new [] each render). */
const EMPTY_WAVEFORM: number[] = [];
const DEFAULT_TEXT_CLIP_DURATION_SEC = 5;

/** Decode audio from a media URL and return normalized waveform samples. */
async function decodeAudioWaveform(src: string): Promise<number[]> {
  // Default fetch (no forced CORS) — blob: URLs and same-origin editor saves decode more reliably.
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Waveform fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new Error("Empty audio");
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const audio = await ctx.decodeAudioData(buf.slice(0));
  ctx.close();
  const nCh = audio.numberOfChannels;
  const len = audio.length;
  if (len === 0 || nCh < 1) throw new Error("No audio channel");
  let mean = 0;
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let c = 0; c < nCh; c++) s += audio.getChannelData(c)[i];
    mean += s / nCh;
  }
  mean /= len;
  const step = Math.max(1, Math.floor(len / WAVEFORM_SAMPLES));
  const out: number[] = [];
  for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
    const start = i * step;
    let max = 0;
    for (let j = 0; j < step && start + j < len; j++) {
      let s = 0;
      for (let c = 0; c < nCh; c++) s += audio.getChannelData(c)[start + j];
      s /= nCh;
      max = Math.max(max, Math.abs(s - mean));
    }
    out.push(max);
  }
  const peak = Math.max(...out, 1e-9);
  const meanAmp = out.reduce((a, b) => a + b, 0) / out.length;
  const denom = Math.max(peak, meanAmp * 2.5, 1e-6);
  return out.map((v) => Math.min(1, v / denom));
}

/** Load media metadata and return full duration in seconds (undefined on failure). */
async function probeMediaDurationSec(
  src: string,
  kind: "audio" | "video"
): Promise<number | undefined> {
  return new Promise<number | undefined>((resolve) => {
    const el =
      kind === "audio"
        ? document.createElement("audio")
        : document.createElement("video");
    let done = false;
    const finish = (duration?: number) => {
      if (done) return;
      done = true;
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        // ignore cleanup errors
      }
      resolve(duration);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = toFinite(
        (el as HTMLAudioElement | HTMLVideoElement).duration,
        0
      );
      finish(d > 0 ? d : undefined);
    };
    el.onerror = () => finish(undefined);
    el.src = src;
  });
}

export type SubtitleStyle = {
  textSize: number;
  textColor: string;
  backgroundColor: string;
  width: number;
  positionX: number;
  positionY: number;
  borderColor: string;
  highlightTextColor: string;
  highlightBgColor: string;
  /** When true, only the active karaoke word is visible (no other words). */
  showHighlightedWordOnly?: boolean;
};

/** Merge global Transcribe settings with optional per-subtitle-clip overrides. */
function mergeSubtitleStyleGlobalAndClip(
  global: SubtitleStyle,
  clipPatch?: Partial<SubtitleStyle> | undefined
): SubtitleStyle {
  if (!clipPatch) return global;
  const out = { ...global };
  (Object.entries(clipPatch) as [keyof SubtitleStyle, SubtitleStyle[keyof SubtitleStyle] | undefined][]).forEach(
    ([k, v]) => {
      if (v !== undefined) (out as Record<string, unknown>)[k as string] = v;
    }
  );
  return out;
}

/** Renders subtitle text with optional word-level highlight (yellow) at current time. */
function SubtitleBlock({
  sub,
  subtitleStyle,
}: {
  sub: EditorClip;
  subtitleStyle?: SubtitleStyle;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  /** Time into this subtitle clip; matches `words[].start/end` (local to Sequence, not global timeline). */
  const currentTimeSec = frame / Math.max(1, fps);

  const baseStyle: React.CSSProperties = {
    backgroundColor: subtitleStyle
      ? (subtitleStyle.backgroundColor === TRANSPARENT_VALUE
        ? "transparent"
        : hexToRgba(subtitleStyle.backgroundColor, 0.7))
      : "rgba(0,0,0,0.7)",
    color: subtitleStyle?.textColor ?? "#fff",
    padding: "6px 16px",
    borderRadius: 4,
    fontSize: (subtitleStyle?.textSize != null && subtitleStyle.textSize > 0) ? subtitleStyle.textSize : 24,
    fontFamily: "sans-serif",
    textAlign: "center",
    width: subtitleStyle?.width != null && subtitleStyle.width > 0 ? `${subtitleStyle.width}px` : "800px",
    textShadow: subtitleStyle?.borderColor
      ? [
          `-1px -1px 0 ${subtitleStyle.borderColor}`,
          `1px -1px 0 ${subtitleStyle.borderColor}`,
          `-1px 1px 0 ${subtitleStyle.borderColor}`,
          `1px 1px 0 ${subtitleStyle.borderColor}`,
        ].join(", ")
      : undefined,
  };

  const words = sub.words;
  const highlightTextColor = subtitleStyle?.highlightTextColor ?? "#ffff00";
  const highlightBgColor = subtitleStyle?.highlightBgColor ?? "#000000";
  const showHighlightedWordOnly = subtitleStyle?.showHighlightedWordOnly === true;

  if (words != null && words.length > 0 && showHighlightedWordOnly) {
    const idx = words.findIndex(
      (w) => currentTimeSec >= w.start && currentTimeSec < w.end
    );
    if (idx < 0) return null;
    const w = words[idx];
    const bg = highlightBgColor === TRANSPARENT_VALUE ? "transparent" : highlightBgColor;
    return (
      <div style={baseStyle}>
        <span style={{ position: "relative", display: "inline-block" }}>
          <span
            style={{
              position: "absolute",
              left: -10,
              right: -10,
              top: -2,
              bottom: -2,
              backgroundColor: bg,
              borderRadius: 10,
              zIndex: 0,
            }}
            aria-hidden
          />
          <span style={{ position: "relative", zIndex: 1, color: highlightTextColor }}>{w.text}</span>
        </span>
      </div>
    );
  }

  if (words != null && words.length > 0) {
    return (
      <div style={baseStyle}>
        {words.map((w, i) => {
          const highlighted = currentTimeSec >= w.start && currentTimeSec < w.end;
          const bg = highlightBgColor === TRANSPARENT_VALUE ? "transparent" : highlightBgColor;
          return (
            <React.Fragment key={i}>
              <span style={{ position: "relative", display: "inline-block" }}>
                {highlighted && (
                  <span
                    style={{
                      position: "absolute",
                      left: -10,
                      right: -10,
                      top: -2,
                      bottom: -2,
                      backgroundColor: bg,
                      borderRadius: 10,
                      zIndex: 0,
                    }}
                    aria-hidden
                  />
                )}
                <span style={{ position: "relative", zIndex: 1, color: highlighted ? highlightTextColor : undefined }}>
                  {w.text}
                </span>
              </span>
              {i < words.length - 1 ? " " : ""}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  return <div style={baseStyle}>{sub.text}</div>;
}

/** Renders a text clip overlay (centered text, not subtitle). */
function TextClipOverlay({ clip }: { clip: EditorClip }) {
  const { width: compW, height: compH } = useVideoConfig();
  const fontSize = Math.max(12, toFinite(clip.textSize, 60));
  const fontFamily = clip.fontFamily || "sans-serif";
  const textColor = clip.textColor ?? "#000000";
  const bgColor = clip.textBgColor === TRANSPARENT_VALUE || clip.textBgColor == null
    ? "transparent"
    : clip.textBgColor;
  const posX = toFinite(clip.textPositionX, compW / 2);
  const posY = toFinite(clip.textPositionY, Math.round(compH * 0.3));
  const maxW =
    clip.textWidth != null && Number.isFinite(clip.textWidth) && clip.textWidth > 0
      ? Math.min(clip.textWidth, compW * 0.98)
      : compW * 0.9;
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: posX,
          top: posY,
          transform: "translate(-50%, -50%)",
          maxWidth: maxW,
          width: clip.textWidth != null && Number.isFinite(clip.textWidth) && clip.textWidth > 0 ? maxW : undefined,
          maxHeight: compH * 0.9,
          fontFamily,
          fontSize: `${fontSize}px`,
          color: textColor,
          backgroundColor: bgColor,
          padding: bgColor !== "transparent" ? "4px 24px" : 0,
          borderRadius: bgColor !== "transparent" ? 10 : 0,
          textAlign: "center",
          textShadow: "0 1px 2px rgba(0,0,0,0.8)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {clip.text ?? ""}
      </div>
    </AbsoluteFill>
  );
}

export function EditorCompositionWithProps({
  clips: rawClips = [],
  subtitleStyle,
  zoom: zoomProp = 1,
  speed: speedProp = 1,
}: {
  clips?: EditorClip[];
  subtitleStyle?: SubtitleStyle;
  zoom?: number;
  /** Fallback playback speed when clips have no per-clip playbackSpeed */
  speed?: number;
}) {
  const { fps, width: compW, height: compH } = useVideoConfig();
  const globalZoom = Number.isFinite(zoomProp) && zoomProp > 0 ? zoomProp : 1;
  const globalSpeed =
    Number.isFinite(speedProp) && speedProp > 0.01 ? Math.min(speedProp, 100) : 1;
  const clipVideoZoom = (clip: EditorClip) => {
    const z = clip.videoZoom;
    return z != null && Number.isFinite(z) && z > 0 ? z : globalZoom;
  };
  const allEnabled = rawClips.filter((c) => !c.disabled);
  const clips = allEnabled.filter((c) => c.kind !== "subtitle" && c.kind !== "text");
  const subtitleClips = allEnabled.filter((c) => c.kind === "subtitle");
  const textClips = allEnabled.filter((c) => c.kind === "text");

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
      return start + clipTimelineDurationForTotal(c, globalSpeed);
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
          const dur = clipTimelineDurationForTotal(c, globalSpeed);
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
                    const cDur = clipTimelineDurationForTotal(c, globalSpeed);
                    const cEnd = cStart + cDur;
                    const start = Math.max(clipStartSec, cStart);
                    const end = Math.min(clipEndSec, cEnd);
                    return [start, end] as [number, number];
                  })
                  .filter(([s, e]) => e > s);

              const isAudioSrc = /\.(mp3|wav|ogg|aac|flac|webm|m4a)(\?|$)/i.test(clip.src) ||
                clip.src.startsWith("blob:");

              const clipVolume = Math.max(0, Math.min(1, toFinite(clip.volume, 1)));
              const renderClipSequence = (
                trimStart: number,
                trimEnd: number,
                volume: number | ((frame: number) => number),
                isAudioOnly: boolean,
                keySuffix: string
              ) => {
                const speed = clipPlaybackSpeed(clip, globalSpeed);
                const srcSpan = Math.max(0, trimEnd - trimStart);
                const durationSec = srcSpan / speed;
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
                const vol = typeof volume === "number"
                  ? volume * clipVolume
                  : overlapSeconds.length > 0
                    ? (frame: number) => {
                        const t = frame / safeFps;
                        return overlapSeconds.some(([s, e]) => t >= s && t < e)
                          ? 0
                          : volume(frame) * clipVolume;
                      }
                    : (frame: number) => volume(frame) * clipVolume;

                const useAudioElement = isAudioOnly && (clip.kind === "audio");

                return (
                  <Sequence
                    key={`${clip.id}-${keySuffix}`}
                    from={fromFrame}
                    durationInFrames={durationInFrames}
                    name={`Clip ${clip.id} ${keySuffix}`}
                  >
                    <AbsoluteFill
                      style={
                        useAudioElement
                          ? undefined
                          : {
                              overflow: "hidden",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }
                      }
                    >
                      {useAudioElement ? (
                        <Audio
                          src={clip.src}
                          trimBefore={trimBefore}
                          volume={vol}
                          playbackRate={speed}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            transform: `translate(${toFinite(clip.videoPositionX, 0)}px, ${toFinite(clip.videoPositionY, 0)}px) scale(${clipVideoZoom(clip)})`,
                            transformOrigin: "center center",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Video
                            src={clip.src}
                            trimBefore={trimBefore}
                            volume={vol}
                            playbackRate={speed}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "contain",
                            }}
                          />
                        </div>
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
              if (clipKind === "text") return [];
              const trimStart = toFinite(clip.trimStartSec, 0);
              const trimEnd = toFinite(clip.trimEndSec, 10);
              const clipStartSec = toFinite(clip.startTimeSec, 0);
              const clipEndSec = clipStartSec + clipTimelineDurationForTotal(clip, globalSpeed);
              const overlapSeconds = overlapSecondsForClip(clipStartSec, clipEndSec);
              const volume =
                clipKind === "video"
                  ? 0
                  : clipKind === "audio"
                    ? 1
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
      {textClips.length > 0 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {textClips.map((clip) => {
            const trimStart = toFinite(clip.trimStartSec, 0);
            const trimEnd = toFinite(clip.trimEndSec, 5);
            const durationSec = Math.max(0, trimEnd - trimStart);
            if (durationSec <= 0) return null;
            const clipStart = toFinite(clip.startTimeSec, 0);
            const fromFrame = Math.round(clipStart * safeFps);
            const durationInFrames = Math.max(1, Math.round(durationSec * safeFps));
            return (
              <Sequence
                key={`text-${clip.id}`}
                from={fromFrame}
                durationInFrames={durationInFrames}
                name={`Text ${clip.id}`}
              >
                <TextClipOverlay clip={clip} />
              </Sequence>
            );
          })}
        </AbsoluteFill>
      )}
      {subtitleClips.length > 0 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {subtitleClips.map((sub) => {
            const durSec = Math.max(0, toFinite(sub.trimEndSec, 0) - toFinite(sub.trimStartSec, 0));
            const subStart = toFinite(sub.startTimeSec, 0);
            const fromFrame = Math.round(subStart * safeFps);
            const durationInFrames = Math.max(1, Math.round((subStart + durSec) * safeFps) - fromFrame);
            const merged =
              subtitleStyle != null
                ? mergeSubtitleStyleGlobalAndClip(subtitleStyle, sub.subtitleStyle)
                : undefined;
            const posX = merged?.positionX ?? compW / 2;
            const posY = merged?.positionY ?? Math.round(compH * 0.3);
            return (
              <Sequence
                key={sub.id}
                from={fromFrame}
                durationInFrames={durationInFrames}
                name={`Sub ${sub.id}`}
              >
                <AbsoluteFill
                  style={{
                    position: "absolute" as const,
                    left: posX,
                    bottom: posY,
                    width: "auto",
                    height: "auto",
                    transform: "translateX(-50%)",
                    justifyContent: "flex-end" as const,
                    alignItems: "center" as const,
                  }}
                >
                  <SubtitleBlock sub={sub} subtitleStyle={merged} />
                </AbsoluteFill>
              </Sequence>
            );
          })}
        </AbsoluteFill>
      )}
    </>
  );
}

export type EditorProps = { projectId: string };

export default function Editor({ projectId }: EditorProps) {
  const [clips, setClips] = useState<EditorClip[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = loadEditorState(projectId).clips as unknown as EditorClip[];
    if (!Array.isArray(raw)) return [];
    // blob: URLs never survive a full reload; drop them so we don’t show broken clips.
    return raw.filter(
      (c) => typeof c?.src === "string" && !c.src.startsWith("blob:")
    ) as EditorClip[];
  });
  const clipsRef = useRef<EditorClip[]>(clips);
  useLayoutEffect(() => {
    clipsRef.current = clips;
  }, [clips]);
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
  /** Deep-cloned clips from Edit → Copy (Cmd/Ctrl+C); paste appends after track end. */
  const clipsClipboardRef = useRef<EditorClip[] | null>(null);
  const editorNodePlayBusyRef = useRef(false);
  const [breakToolEnabled, setBreakToolEnabled] = useState(false);
  const [breakToolHoverClipId, setBreakToolHoverClipId] = useState<string | null>(null);
  const [breakToolHoverTimelineSec, setBreakToolHoverTimelineSec] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribingAll, setIsTranscribingAll] = useState(false);
  const [isCuttingSilences, setIsCuttingSilences] = useState(false);
  const [silenceBuffer, setSilenceBuffer] = useState(0.5);
  const [cutSilencesOpen, setCutSilencesOpen] = useState(false);
  const [textsOpen, setTextsOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [volumeInputValue, setVolumeInputValue] = useState("");
  const [textFontFamily, setTextFontFamily] = useState("sans-serif");
  const [textSizeInput, setTextSizeInput] = useState("60");
  const [newTextInput, setNewTextInput] = useState("");
  const [textColor, setTextColor] = useState("#000000");
  const [textBgColor, setTextBgColor] = useState("#ffffff");
  const [textPositionX, setTextPositionX] = useState("");
  const [textPositionY, setTextPositionY] = useState("");
  const [textWidthInput, setTextWidthInput] = useState("");
  const [textPanelColorPickerOpen, setTextPanelColorPickerOpen] = useState<"textColor" | "textBg" | null>(null);
  const panelTextColorAnchorRef = useRef<HTMLButtonElement>(null);
  const panelTextBgColorAnchorRef = useRef<HTMLButtonElement>(null);
  const [transformOpen, setTransformOpen] = useState(false);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [zoomInput, setZoomInput] = useState("1");
  /** Per-clip video frame position (Transform panel when a video/combined clip is selected). */
  const [videoPositionXInput, setVideoPositionXInput] = useState("0");
  const [videoPositionYInput, setVideoPositionYInput] = useState("0");
  /** Persisted global Transform zoom (applied to all video clips when they have no per-clip videoZoom). */
  const [globalZoomInput, setGlobalZoomInput] = useState("1");
  /** Persisted global playback speed (applied when clips have no per-clip playbackSpeed). */
  const [globalSpeedInput, setGlobalSpeedInput] = useState("1");
  const [speedInput, setSpeedInput] = useState("1");
  const [compWidthInput, setCompWidthInput] = useState("1920");
  const [compHeightInput, setCompHeightInput] = useState("1080");
  const transformSettingsLoadedRef = useRef(false);
  const [subtitleTextSize, setSubtitleTextSize] = useState(24);
  const [subtitleTextColor, setSubtitleTextColor] = useState("#ffffff");
  const [subtitleBgColor, setSubtitleBgColor] = useState("#000000");
   const [subtitleBorderColor, setSubtitleBorderColor] = useState("#ffffff");
  const [subtitleHighlightTextColor, setSubtitleHighlightTextColor] = useState("#ffff00");
  const [subtitleHighlightBgColor, setSubtitleHighlightBgColor] = useState("#000000");
  const [subtitleShowHighlightedWordOnly, setSubtitleShowHighlightedWordOnly] = useState(false);
  const [subtitleWidth, setSubtitleWidth] = useState(800);
  const [subtitlePositionX, setSubtitlePositionX] = useState(Math.round(COMP_WIDTH / 2));
  const [subtitlePositionY, setSubtitlePositionY] = useState(Math.round(COMP_HEIGHT * 0.3));
  const [colorPickerOpen, setColorPickerOpen] = useState<null | "text" | "bg" | "border" | "highlightText" | "highlightBg">(null);
  const textColorAnchorRef = useRef<HTMLButtonElement>(null);
  const bgColorAnchorRef = useRef<HTMLButtonElement>(null);
  const borderColorAnchorRef = useRef<HTMLButtonElement>(null);
  const highlightTextColorAnchorRef = useRef<HTMLButtonElement>(null);
  const highlightBgColorAnchorRef = useRef<HTMLButtonElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const timelinePxPerSecRef = useRef(timelinePxPerSec);
  timelinePxPerSecRef.current = timelinePxPerSec;
  const blobPersistInFlightRef = useRef(false);
  /** When true, a clips change happened while blob upload was running; flush save after it finishes. */
  const blobSaveSkippedWhileInFlightRef = useRef(false);
  const subtitleSettingsLoadedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = loadEditorSubtitleSettings(projectId);
    setSubtitleTextSize(s.textSize);
    setSubtitleTextColor(s.textColor);
    setSubtitleBgColor(s.backgroundColor);
    setSubtitleBorderColor(s.borderColor);
    setSubtitleHighlightTextColor(s.highlightTextColor);
    setSubtitleHighlightBgColor(s.highlightBgColor);
    setSubtitleShowHighlightedWordOnly(s.showHighlightedWordOnly ?? false);
    setSubtitleWidth(s.width);
    setSubtitlePositionX(s.positionX);
    setSubtitlePositionY(s.positionY);
    queueMicrotask(() => {
      subtitleSettingsLoadedRef.current = true;
    });
    const t = loadEditorTransformSettings(projectId);
    setGlobalZoomInput(t.zoom);
    setZoomInput(t.zoom);
    setGlobalSpeedInput(t.speed ?? "1");
    setSpeedInput(t.speed ?? "1");
    setCompWidthInput(t.compWidth);
    setCompHeightInput(t.compHeight);
    queueMicrotask(() => {
      transformSettingsLoadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !subtitleSettingsLoadedRef.current) return;
    saveEditorSubtitleSettings(projectId, {
      textSize: subtitleTextSize,
      textColor: subtitleTextColor,
      backgroundColor: subtitleBgColor,
      borderColor: subtitleBorderColor,
      highlightTextColor: subtitleHighlightTextColor,
      highlightBgColor: subtitleHighlightBgColor,
      showHighlightedWordOnly: subtitleShowHighlightedWordOnly,
      width: subtitleWidth,
      positionX: subtitlePositionX,
      positionY: subtitlePositionY,
    });
  }, [
    subtitleTextSize,
    subtitleTextColor,
    subtitleBgColor,
    subtitleBorderColor,
    subtitleHighlightTextColor,
    subtitleHighlightBgColor,
    subtitleShowHighlightedWordOnly,
    subtitleWidth,
    subtitlePositionX,
    subtitlePositionY,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !transformSettingsLoadedRef.current) return;
    saveEditorTransformSettings(projectId, {
      zoom: globalZoomInput,
      speed: globalSpeedInput,
      compWidth: compWidthInput,
      compHeight: compHeightInput,
    });
  }, [globalZoomInput, globalSpeedInput, compWidthInput, compHeightInput, projectId]);

  useEffect(() => {
    saveEditorState(projectId, { clips });

    const blobClips = clips.filter((c) => c.src.startsWith("blob:"));
    if (blobClips.length === 0) {
      return;
    }
    if (blobPersistInFlightRef.current) {
      blobSaveSkippedWhileInFlightRef.current = true;
      return;
    }
    blobPersistInFlightRef.current = true;
    (async () => {
      const savedPathById = new Map<string, string>();
      for (const c of blobClips) {
        try {
          const res = await fetch(c.src);
          const blob = await res.blob();
          const form = new FormData();
          form.append("file", blob, c.fileName || `${c.id}.mp4`);
          form.append("projectId", projectId);
          form.append("clipId", c.id);
          const r = await fetch("/api/editor-save-blob", {
            method: "POST",
            body: form,
          });
          const data = await r.json();
          if (data.path) savedPathById.set(c.id, data.path as string);
        } catch {
          // ignore per-clip save failure and continue remaining uploads
        }
      }
      if (savedPathById.size > 0) {
        setClips((prev) => {
          const next = prev.map((c) => {
            const savedPath = savedPathById.get(c.id);
            if (!savedPath || !c.src.startsWith("blob:")) return c;
            return { ...c, src: savedPath };
          });
          saveEditorState(projectId, { clips: next });
          return next;
        });
      } else {
        // Uploads failed but timeline (e.g. new subtitles) should still persist
        saveEditorState(projectId, { clips: clipsRef.current });
      }
    })().finally(() => {
      blobPersistInFlightRef.current = false;
      if (blobSaveSkippedWhileInFlightRef.current) {
        blobSaveSkippedWhileInFlightRef.current = false;
        // Let React commit any clips that changed during upload (e.g. transcribe), then save + re-run effect
        queueMicrotask(() => {
          requestAnimationFrame(() => {
            saveEditorState(projectId, { clips: clipsRef.current });
            setClips((prev) => [...prev]);
          });
        });
      }
    });
  }, [clips, projectId]);

  const globalSpeedNum = useMemo(() => {
    const g = parseFloat(globalSpeedInput);
    return Number.isFinite(g) && g > 0.01 ? Math.min(g, 100) : 1;
  }, [globalSpeedInput]);

  const totalDurationSec = Math.max(
    0.1,
    ...clips.map((c) => {
      const start = toFinite(c.startTimeSec, 0);
      return start + clipTimelineDurationForTotal(c, globalSpeedNum);
    }),
    0
  );
  const durationInFrames = Math.max(
    1,
    Math.ceil(toFinite(totalDurationSec * FPS, 0))
  );

  const addTextClip = useCallback(() => {
    const text = newTextInput.trim();
    if (!text) return;
    const sizeNum = parseFloat(textSizeInput);
    const textSize = Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : 60;
    const posX = textPositionX === "" ? undefined : parseFloat(textPositionX);
    const posY = textPositionY === "" ? undefined : parseFloat(textPositionY);
    const widthNum = parseFloat(textWidthInput);
    const textWidth = Number.isFinite(widthNum) && widthNum > 0 ? widthNum : undefined;
    setClips((prev) => {
      const textClipsList = prev.filter((c) => c.kind === "text");
      const maxTrack = prev.length === 0
        ? -1
        : Math.max(...prev.map((c) => toFinite(c.trackIndex, 0)));
      let trackIndex: number;
      let startTimeSec: number;
      if (textClipsList.length > 0) {
        trackIndex = toFinite(textClipsList[0].trackIndex, 0);
        const endTimes = textClipsList.map(
          (c) =>
            toFinite(c.startTimeSec, 0) +
            Math.max(0, toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0))
        );
        startTimeSec = Math.max(0, ...endTimes);
      } else {
        trackIndex = maxTrack + 1;
        startTimeSec = 0;
      }
      const id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const newClip: EditorClip = {
        id,
        src: "",
        trimStartSec: 0,
        trimEndSec: DEFAULT_TEXT_CLIP_DURATION_SEC,
        durationSec: DEFAULT_TEXT_CLIP_DURATION_SEC,
        startTimeSec,
        trackIndex,
        kind: "text",
        text,
        fontFamily: textFontFamily,
        textSize,
        textColor,
        textBgColor,
        ...(Number.isFinite(posX) ? { textPositionX: posX } : {}),
        ...(Number.isFinite(posY) ? { textPositionY: posY } : {}),
        ...(textWidth != null ? { textWidth } : {}),
      };
      return [...prev, newClip];
    });
    setNewTextInput("");
  }, [newTextInput, textSizeInput, textFontFamily, textColor, textBgColor, textPositionX, textPositionY, textWidthInput]);

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
        void (async () => {
          stream.getTracks().forEach((t) => t.stop());
          playerRef.current?.setVolume(1);
          const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
          if (blob.size > 0) {
            const id = newEditorClipId();
            const file = new File([blob], "voiceover.webm", {
              type: blob.type || "audio/webm",
            });
            const temp = URL.createObjectURL(blob);
            let dur = 10;
            try {
              dur = (await probeMediaDurationSec(temp, "audio")) ?? 10;
            } finally {
              URL.revokeObjectURL(temp);
            }
            const path = await persistEditorFileToServer(projectId, id, file);
            if (path) {
              const endSec = toFinite(dur, 10);
              setClips((prev) => {
                const maxTrack =
                  prev.length === 0
                    ? -1
                    : Math.max(...prev.map((c) => toFinite(c.trackIndex, 0)));
                const newTrack = maxTrack + 1;
                return [
                  ...prev,
                  {
                    id,
                    src: path,
                    trimStartSec: 0,
                    trimEndSec: Math.max(0, endSec),
                    durationSec: Number.isFinite(dur) ? dur : undefined,
                    startTimeSec: 0,
                    trackIndex: newTrack,
                    kind: "audio" as const,
                    fileName: "Voiceover",
                  },
                ];
              });
            } else {
              alert("Could not save recording to the project.");
            }
          }
          setIsRecording(false);
        })();
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
  }, [projectId, stopRecording]);

  const transcribeClip = useCallback(async (clipId: string, clipHint?: EditorClip) => {
    const clip = clipHint ?? clips.find((c) => c.id === clipId);
    if (!clip) {
      console.warn("[Transcribe] transcribeClip: no clip for id", clipId);
      return;
    }
    setClipContextMenu(null);
    const log = (...args: unknown[]) => console.log("[Transcribe]", ...args);
    const tAll = performance.now();
    try {
      log(
        `clip ${clip.id} start`,
        { kind: clip.kind, src: clip.src.slice(0, 80), fileName: clip.fileName ?? "(none)" }
      );
      log(`clip ${clip.id} fetching media…`);
      const tFetch = performance.now();
      const res = await fetch(clip.src);
      if (!res.ok) {
        throw new Error(`Failed to fetch clip media: ${res.status} ${res.statusText}`);
      }
      const blob = await res.blob();
      log(
        `clip ${clip.id} media ready in ${Math.round(performance.now() - tFetch)}ms`,
        { bytes: blob.size, type: blob.type || "(unknown)" }
      );
      const formData = new FormData();
      formData.append("audio", blob, clip.fileName ?? "clip.webm");
      log(`clip ${clip.id} POST /api/whisper-clip (Whisper can take several minutes for long audio)…`);
      const tPost = performance.now();
      const response = await fetch("/api/whisper-clip", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as Record<string, unknown> & {
        segments?: unknown;
        error?: string;
      };
      log(
        `clip ${clip.id} API responded in ${Math.round(performance.now() - tPost)}ms`,
        { ok: response.ok, status: response.status }
      );
      if (!response.ok) {
        console.error("[Transcribe] API error body:", data);
        alert(
          `Transcription failed (${response.status}): ${typeof data.error === "string" ? data.error : JSON.stringify(data)}`
        );
        return;
      }

      type Seg = { start: number; end: number; text: string; words?: { start: number; end: number; word?: string; text?: string }[] };
      const segments: Seg[] = (data.segments as Seg[]) ?? [];
      if (segments.length === 0) {
        console.warn(
          "[Transcribe] clip",
          clip.id,
          "returned 0 segments. Response keys:",
          Object.keys(data),
          "sample:",
          data
        );
        alert(
          "Transcription returned no segments. Check the browser console ([Transcribe] logs) and the terminal running `next dev` for Whisper errors."
        );
        return;
      }
      log(`clip ${clip.id} got ${segments.length} segment(s), applying to timeline…`);

      const clipOffset = toFinite(clip.startTimeSec, 0);

      const segmentToSubClip = (seg: Seg, i: number, trackIdx: number): EditorClip => {
        const segStart = toFinite(seg.start, 0);
        const segEnd = toFinite(seg.end, segStart);
        const segDur = Math.max(0.01, segEnd - segStart);
        const trimText = seg.text.trim();
        let words: { start: number; end: number; text: string }[] | undefined;
        if (seg.words?.length) {
          // SubtitleBlock uses useCurrentFrame() inside <Sequence> = seconds *local* to this clip (0…dur).
          // Whisper JSON uses absolute seconds from file start for both segments and words. Map to local:
          // word_local = word_abs - seg.start. If an API emits words already relative to the segment,
          // raw < seg.start (for a late segment) — use raw as local.
          words = seg.words
            .map((w) => {
              const rawS = toFinite(w.start, 0);
              const rawE = toFinite(w.end, 0);
              const looksAbsolute =
                rawS >= segStart - 1e-3 || rawE > segStart + 1e-3;
              const startLocal = looksAbsolute
                ? Math.max(0, rawS - segStart)
                : Math.max(0, rawS);
              const endLocal = looksAbsolute
                ? Math.max(0, rawE - segStart)
                : Math.max(0, rawE);
              return {
                start: startLocal,
                end: Math.max(startLocal + 0.01, endLocal),
                text: (w.word ?? w.text ?? "").trim(),
              };
            })
            .filter((w) => w.text.length > 0);
        }
        if (!words?.length && trimText) {
          const tokens = trimText.split(/\s+/);
          const n = tokens.length;
          words = tokens.map((text, j) => ({
            start: segStart + (j / n) * segDur,
            end: segStart + ((j + 1) / n) * segDur,
            text,
          }));
        }
        return {
          id: `sub-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          src: "",
          trimStartSec: 0,
          trimEndSec: seg.end - seg.start,
          durationSec: seg.end - seg.start,
          startTimeSec: clipOffset + seg.start,
          trackIndex: trackIdx,
          kind: "subtitle" as const,
          text: trimText,
          words,
        };
      };

      const removeSubtitleOverlaps = (subs: EditorClip[]): EditorClip[] => {
        if (subs.length <= 1) return subs;
        const sorted = [...subs].sort((a, b) => toFinite(a.startTimeSec, 0) - toFinite(b.startTimeSec, 0));
        const minDur = 0.01;
        for (let i = 0; i < sorted.length - 1; i++) {
          const curr = sorted[i];
          const next = sorted[i + 1];
          const currStart = toFinite(curr.startTimeSec, 0);
          const currEnd = currStart + (toFinite(curr.trimEndSec, 0) - toFinite(curr.trimStartSec, 0));
          const nextStart = toFinite(next.startTimeSec, 0);
          if (currEnd > nextStart) {
            const newDur = Math.max(minDur, nextStart - currStart);
            sorted[i] = { ...curr, trimEndSec: toFinite(curr.trimStartSec, 0) + newDur };
          }
        }
        return sorted;
      };

      setClips((prev) => {
        const existingSubTrack = prev.find((c) => c.kind === "subtitle");
        if (existingSubTrack != null) {
          const subTrackIdx = toFinite(existingSubTrack.trackIndex, 0);
          const newSubs = segments.map((seg, i) => segmentToSubClip(seg, i, subTrackIdx));
          const existingSubs = prev.filter((c) => c.kind === "subtitle");
          const allSubs = removeSubtitleOverlaps([...existingSubs, ...newSubs]);
          return [...prev.filter((c) => c.kind !== "subtitle"), ...allSubs];
        }
        const shifted = prev.map((c) => ({ ...c, trackIndex: toFinite(c.trackIndex, 0) + 1 }));
        const subtitleClips = removeSubtitleOverlaps(segments.map((seg, i) => segmentToSubClip(seg, i, 0)));
        return [...subtitleClips, ...shifted];
      });
      console.log(
        "[Transcribe] clip",
        clip.id,
        "finished OK in",
        `${Math.round(performance.now() - tAll)}ms total`
      );
    } catch (err) {
      console.error("[Transcribe] clip", clipId, "failed:", err);
      alert("Transcription failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [clips]);

  const transcribeAll = useCallback(async (clipsOverride?: EditorClip[]) => {
    const source = clipsOverride ?? clips;
    const selected = selectedClipId
      ? source.find((c) => c.id === selectedClipId)
      : null;
    const selectedIsAudioLike =
      selected != null &&
      !selected.disabled &&
      (selected.kind === "audio" || selected.kind === "combined");

    const audioClips = selectedIsAudioLike
      ? [selected]
      : source.filter(
          (c) => (c.kind === "audio" || c.kind === "combined") && !c.disabled
        );
    if (audioClips.length === 0) {
      console.warn("[Transcribe] transcribeAll: no audio/combined clips to transcribe");
      return;
    }
    const t0 = performance.now();
    console.log(
      "[Transcribe] transcribeAll: starting",
      audioClips.length,
      "clip(s). Open DevTools → Console to watch progress. Long files = several minutes each (Whisper medium).",
      audioClips.map((c) => ({ id: c.id, kind: c.kind, src: c.src.slice(0, 60) }))
    );
    setIsTranscribingAll(true);
    try {
      let i = 0;
      for (const clip of audioClips) {
        i += 1;
        console.log(
          `[Transcribe] transcribeAll: (${i}/${audioClips.length}) clip ${clip.id} (${clip.kind})…`
        );
        await transcribeClip(clip.id, clip);
        console.log(`[Transcribe] transcribeAll: (${i}/${audioClips.length}) clip ${clip.id} step done`);
      }
      console.log(
        "[Transcribe] transcribeAll: all done in",
        `${Math.round(performance.now() - t0)}ms`
      );
    } finally {
      setIsTranscribingAll(false);
    }
  }, [clips, selectedClipId, transcribeClip]);

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

  const cutSilences = useCallback(async (clipsOverride?: EditorClip[]) => {
    const sourceClips = clipsOverride ?? clips;
    const audioClips = sourceClips.filter(
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

        const partner = clip.linkedClipId ? sourceClips.find((c) => c.id === clip.linkedClipId) : null;
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
          const src = clip?.src ?? "";
          next = removeClipFromArray(next, id);
          revokeBlobSrcIfOrphaned(next, src);
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

  const flushClipsLayout = useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
    []
  );

  const removeClip = useCallback((id: string) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === id);
      if (!clip) return prev;
      const src = clip.src;
      const next = removeClipFromArray(prev, id);
      revokeBlobSrcIfOrphaned(next, src);
      return next;
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

  /** Split a clip at timeline time T. For combined clips, splits both video and audio at the same T. */
  const splitClipAt = useCallback((clipId: string, timelineSec: number) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === clipId);
      if (!clip) return prev;
      const startSec = toFinite(clip.startTimeSec, 0);
      const k = clip.kind ?? "combined";
      const partnerId = clip.linkedClipId;
      const partner = partnerId ? prev.find((c) => c.id === partnerId) : null;

      const doSplit = (c: EditorClip, trackType: "video" | "audio") => {
        const trim = getEffectiveTrim(c, trackType);
        const trimStart = trim.trimStartSec;
        const trimEnd = trim.trimEndSec;
        const speed = clipPlaybackSpeed(c, globalSpeedNum);
        const timelineDur = Math.max(0, trimEnd - trimStart) / speed;
        const endSec = startSec + timelineDur;
        if (timelineSec <= startSec + MIN_TRIM_DURATION_SEC || timelineSec >= endSec - MIN_TRIM_DURATION_SEC) return null;
        const leftTrimEnd = trimStart + (timelineSec - startSec) * speed;
        const left: EditorClip = { ...c, trimEndSec: leftTrimEnd };
        if (k === "combined" && trackType === "video") {
          (left as EditorClip).trimEndSecVideo = leftTrimEnd;
        }
        if (k === "combined" && trackType === "audio") {
          (left as EditorClip).trimEndSecAudio = leftTrimEnd;
        }
        const rightId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const right: EditorClip = {
          ...c,
          id: rightId,
          startTimeSec: timelineSec,
          trimStartSec: leftTrimEnd,
          trimEndSec: trimEnd,
        };
        if (k === "combined" && trackType === "video") {
          (right as EditorClip).trimStartSecVideo = leftTrimEnd;
          (right as EditorClip).trimEndSecVideo = trimEnd;
        }
        if (k === "combined" && trackType === "audio") {
          (right as EditorClip).trimStartSecAudio = leftTrimEnd;
          (right as EditorClip).trimEndSecAudio = trimEnd;
        }
        return { left, rightId, right };
      };

      if (k === "combined" && partner) {
        const videoSplit = doSplit(clip, "video");
        const audioSplit = doSplit(partner, "audio");
        if (!videoSplit || !audioSplit) return prev;
        const { left: leftV, rightId: rightVId, right: rightV } = videoSplit;
        const { left: leftA, rightId: rightAId, right: rightA } = audioSplit;
        (rightV as EditorClip).linkedClipId = rightAId;
        (rightA as EditorClip).linkedClipId = rightVId;
        return prev.flatMap((c) => {
          if (c.id === clipId) return [leftV, rightV];
          if (c.id === partnerId) return [leftA, rightA];
          return [c];
        });
      }

      const trackType = k === "audio" ? "audio" : "video";
      const split = doSplit(clip, trackType);
      if (!split) return prev;
      const { left, right } = split;
      // Splitting a single clip: both halves are independent. If this clip was linked (e.g. audio linked to video), unlink both halves and clear the partner's link.
      (left as EditorClip).linkedClipId = undefined;
      (right as EditorClip).linkedClipId = undefined;
      return prev.flatMap((c) => {
        if (c.id === clipId) return [left, right];
        if (partnerId && c.id === partnerId) return [{ ...c, linkedClipId: undefined }];
        return [c];
      });
    });
    setBreakToolHoverClipId(null);
  }, [globalSpeedNum]);

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

  const handleBreakToolMouseMove = useCallback((clipId: string | null, timelineSec: number) => {
    setBreakToolHoverClipId(clipId);
    setBreakToolHoverTimelineSec(timelineSec);
  }, []);

  const handleBreakToolClick = useCallback(
    (clipId: string, timelineSec: number) => {
      splitClipAt(clipId, timelineSec);
    },
    [splitClipAt]
  );

  const clearAllClipsProgrammatic = useCallback(async () => {
    setClips((prev) => {
      const seenBlob = new Set<string>();
      prev.forEach((c) => {
        if (c.src.startsWith("blob:") && !seenBlob.has(c.src)) {
          seenBlob.add(c.src);
          URL.revokeObjectURL(c.src);
        }
      });
      return [];
    });
    setSelectedClipId(null);
    setPlayheadTimeSec(0);
    playerRef.current?.seekTo(0);
    saveEditorState(projectId, { clips: [] });
    try {
      await fetch("/api/editor-clear-saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
    } catch {
      // ignore
    }
  }, [projectId]);

  const uploadClipsFromFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const tempUrl = URL.createObjectURL(file);
        let durationSec = 10;
        try {
          durationSec =
            (await probeMediaDurationSec(
              tempUrl,
              isAudioFile(file) ? "audio" : "video"
            )) ?? 10;
        } finally {
          URL.revokeObjectURL(tempUrl);
        }
        const endSec = toFinite(durationSec, 10);

        if (isAudioFile(file)) {
          const id = newEditorClipId();
          const path = await persistEditorFileToServer(projectId, id, file);
          if (!path) {
            alert(
              `Could not save “${file.name}” to the project (upload failed). Check network or file size.`
            );
            continue;
          }
          setClips((prev) => {
            const maxTrack =
              prev.length === 0
                ? -1
                : Math.max(...prev.map((c) => toFinite(c.trackIndex, 0)));
            const newTrack = maxTrack + 1;
            return [
              ...prev,
              {
                id,
                src: path,
                trimStartSec: 0,
                trimEndSec: Math.max(0, endSec),
                durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
                startTimeSec: 0,
                trackIndex: newTrack,
                kind: "audio" as const,
                fileName: file.name,
              },
            ];
          });
        } else {
          const videoId = newEditorClipId();
          const audioId = newEditorClipId();
          const path = await persistEditorFileToServer(projectId, videoId, file);
          if (!path) {
            alert(
              `Could not save “${file.name}” to the project (upload failed). Check network or file size.`
            );
            continue;
          }
          setClips((prev) => {
            const endOfTimeline =
              prev.length === 0
                ? 0
                : Math.max(
                    ...prev.map(
                      (c) =>
                        toFinite(c.startTimeSec, 0) +
                        clipTimelineDurationForTotal(c, globalSpeedNum)
                    )
                  );
            const base = {
              src: path,
              trimStartSec: 0,
              trimEndSec: Math.max(0, endSec),
              durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
              startTimeSec: endOfTimeline,
              fileName: file.name,
            };
            return [
              ...prev,
              {
                ...base,
                id: videoId,
                trackIndex: 0,
                kind: "video" as const,
                linkedClipId: audioId,
              },
              {
                ...base,
                id: audioId,
                trackIndex: 1,
                kind: "audio" as const,
                linkedClipId: videoId,
              },
            ];
          });
        }
      }
    },
    [projectId, globalSpeedNum]
  );

  const handleUploadClips = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      await uploadClipsFromFiles(Array.from(files));
      e.target.value = "";
    },
    [uploadClipsFromFiles]
  );

  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<EditorNodePlayDetail>;
      const d = e.detail;
      if (!d || d.projectId !== projectId) return;

      void (async () => {
        if (editorNodePlayBusyRef.current) {
          d.reject(new Error("Editor is already processing a node play request."));
          return;
        }
        editorNodePlayBusyRef.current = true;
        try {
          const files = await getEditorNodeMediaFiles(d.nodeId);
          if (!files?.length) {
            d.reject(
              new Error(
                "No clips selected for this node. Use “Choose video/audio files…” on the Editor node, then Play again."
              )
            );
            return;
          }
          await clearAllClipsProgrammatic();
          await uploadClipsFromFiles(files);
          await flushClipsLayout();

          const hasAudioLike = (list: EditorClip[]) =>
            list.some(
              (c) => !c.disabled && (c.kind === "audio" || c.kind === "combined")
            );

          let working = clipsRef.current;
          for (let i = 0; i < 80 && !hasAudioLike(working); i++) {
            await new Promise((r) => setTimeout(r, 25));
            working = clipsRef.current;
          }

          if (d.cutSilences) {
            await cutSilences(working);
            await flushClipsLayout();
            await new Promise((r) => setTimeout(r, 50));
            working = clipsRef.current;
          }

          if (d.transcribe) {
            await transcribeAll(working);
          }

          await flushClipsLayout();
          // Wait for blob→server persistence to finish so localStorage gets paths + subtitles together
          const persistDeadline = Date.now() + 180_000;
          while (blobPersistInFlightRef.current && Date.now() < persistDeadline) {
            await new Promise((r) => setTimeout(r, 80));
          }
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          saveEditorState(projectId, { clips: clipsRef.current });

          d.resolve();
        } catch (err) {
          d.reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          editorNodePlayBusyRef.current = false;
        }
      })();
    };
    window.addEventListener(EDITOR_NODE_PLAY_EVENT, handler);
    return () => window.removeEventListener(EDITOR_NODE_PLAY_EVENT, handler);
  }, [
    projectId,
    clearAllClipsProgrammatic,
    uploadClipsFromFiles,
    flushClipsLayout,
    cutSilences,
    transcribeAll,
  ]);

  const updateClip = useCallback(
    (id: string, patch: Partial<EditorClip>) => {
      setClips((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      );
    },
    []
  );

  const onTransformZoomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setZoomInput(v);
      const p = parseFloat(v);
      if (!Number.isFinite(p) || p <= 0) return;
      const sel = clips.find((c) => c.id === selectedClipId);
      const isVid =
        sel != null && (sel.kind === "video" || sel.kind === "combined");
      if (isVid && selectedClipId) {
        updateClip(selectedClipId, { videoZoom: p });
      } else {
        setGlobalZoomInput(String(p));
        setClips((prev) =>
          prev.map((c) => {
            const k = c.kind ?? "combined";
            return k === "video" || k === "combined"
              ? { ...c, videoZoom: undefined }
              : c;
          })
        );
      }
    },
    [clips, selectedClipId, updateClip]
  );

  const onVideoPositionXChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setVideoPositionXInput(v);
      if (!selectedClipId) return;
      const sel = clips.find((c) => c.id === selectedClipId);
      if (!sel || (sel.kind !== "video" && sel.kind !== "combined")) return;
      const p = parseFloat(v);
      if (!Number.isFinite(p)) return;
      updateClip(selectedClipId, { videoPositionX: p });
    },
    [clips, selectedClipId, updateClip]
  );

  const onVideoPositionYChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setVideoPositionYInput(v);
      if (!selectedClipId) return;
      const sel = clips.find((c) => c.id === selectedClipId);
      if (!sel || (sel.kind !== "video" && sel.kind !== "combined")) return;
      const p = parseFloat(v);
      if (!Number.isFinite(p)) return;
      updateClip(selectedClipId, { videoPositionY: p });
    },
    [clips, selectedClipId, updateClip]
  );

  const onTransformSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setSpeedInput(v);
      const p = parseFloat(v);
      if (!Number.isFinite(p) || p <= 0.01) return;
      const speed = Math.min(p, 100);
      const sel = clips.find((c) => c.id === selectedClipId);
      const isMedia =
        sel != null &&
        (sel.kind === "video" || sel.kind === "audio" || sel.kind === "combined");
      if (isMedia && selectedClipId) {
        updateClip(selectedClipId, { playbackSpeed: speed });
      } else {
        setGlobalSpeedInput(String(speed));
        setClips((prev) =>
          prev.map((c) => {
            const k = c.kind ?? "combined";
            return k === "video" || k === "audio" || k === "combined"
              ? { ...c, playbackSpeed: undefined }
              : c;
          })
        );
      }
    },
    [clips, selectedClipId, updateClip]
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
          toFinite(clip.startTimeSec, 0) + clipTimelineDurationForTotal(clip, globalSpeedNum);
        const newEnd =
          toFinite(updated.startTimeSec, 0) +
          clipTimelineDurationForTotal(updated, globalSpeedNum);
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
    [globalSpeedNum]
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
      const aDur = clipTimelineDurationForTotal(a, globalSpeedNum);
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
          const bDur = clipTimelineDurationForTotal(b, globalSpeedNum);
          const bEnd = bStart + bDur;
          if (anchorEnd <= bStart || anchorStart >= bEnd) return b;

          if (anchorEnd > bStart && anchorEnd < bEnd && anchorStart <= bStart) {
            const trimOff = anchorEnd - bStart;
            const ds = timelineDeltaToSource(b, trimOff, globalSpeedNum);
            return {
              ...patchTrimStartBySourceDelta(b, ds),
              startTimeSec: anchorEnd,
            };
          }
          if (anchorStart > bStart && anchorStart < bEnd && anchorEnd >= bEnd) {
            return patchTrimEndFromTimelineSpan(b, bStart, anchorStart, globalSpeedNum);
          }
          if (anchorStart <= bStart && anchorEnd >= bEnd) {
            return patchTrimZeroLength(b);
          }
          if (bStart < anchorStart && bEnd > anchorEnd) {
            return patchTrimEndFromTimelineSpan(b, bStart, anchorStart, globalSpeedNum);
          }
          if (anchorStart < bEnd && anchorEnd > bStart && anchorStart > bStart) {
            return patchTrimEndFromTimelineSpan(b, bStart, anchorStart, globalSpeedNum);
          }
          if (anchorEnd > bStart && anchorEnd < bEnd) {
            const trimOff = anchorEnd - bStart;
            const ds = timelineDeltaToSource(b, trimOff, globalSpeedNum);
            return {
              ...patchTrimStartBySourceDelta(b, ds),
              startTimeSec: anchorEnd,
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
            const pDur = clipTimelineDurationForTotal(partner, globalSpeedNum);
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
    [globalSpeedNum]
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
      const latestXRef = { clientX: e.clientX };
      let rafId: number | null = null;
      const flush = (clientX: number) => {
        const x = Math.max(0, getTimelineX(clientX) - TIMELINE_PADDING_PX);
        const sec = Math.max(0, Math.min(totalDurationSec, x / timelinePxPerSec));
        setPlayheadTimeSec(sec);
        playerRef.current?.seekTo(Math.round(sec * FPS));
      };
      const onMove = (ev: MouseEvent) => {
        latestXRef.clientX = ev.clientX;
        if (rafId != null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          flush(latestXRef.clientX);
        });
      };
      const onUp = () => {
        if (rafId != null) cancelAnimationFrame(rafId);
        flush(latestXRef.clientX);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };
      flush(e.clientX);
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
      const initialTimelineX = getTimelineX(initialClientX);
      const latestPointerRef = { clientX: initialClientX, clientY: 0 };
      let rafId: number | null = null;

      const getTrackIndexFromY = (clientY: number): number => {
        const scrollEl = timelineRef.current;
        if (!scrollEl) return initialTrackIndex;
        const rect = scrollEl.getBoundingClientRect();
        const yInScrollContent = clientY - rect.top + scrollEl.scrollTop - RULER_HEIGHT_PX;
        return Math.max(0, Math.floor(yInScrollContent / TRACK_HEIGHT_PX));
      };

      const applyDragFromClient = (clientX: number, clientY: number) => {
        const currentTimelineX = getTimelineX(clientX);
        const deltaSec = (currentTimelineX - initialTimelineX) / timelinePxPerSec;
        const newStartSec = Math.max(0, initialStartTimeSec + deltaSec);
        const trackIdx = getTrackIndexFromY(clientY);
        setClips((prev) => {
          const moved = prev.find((c) => c.id === id);
          const partnerId = moved?.linkedClipId;
          return prev.map((c) => {
            if (c.id === id) return { ...c, startTimeSec: newStartSec, trackIndex: trackIdx };
            if (partnerId && c.id === partnerId) return { ...c, startTimeSec: newStartSec };
            return c;
          });
        });
      };

      const onMove = (e: MouseEvent) => {
        hasMoved = true;
        latestPointerRef.clientX = e.clientX;
        latestPointerRef.clientY = e.clientY;
        if (rafId != null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          applyDragFromClient(latestPointerRef.clientX, latestPointerRef.clientY);
        });
      };

      const onEnd = () => {
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (hasMoved) {
          const currentTimelineX = getTimelineX(latestPointerRef.clientX);
          const deltaSec = (currentTimelineX - initialTimelineX) / timelinePxPerSec;
          const newStartSec = Math.max(0, initialStartTimeSec + deltaSec);
          const finalTrack = getTrackIndexFromY(latestPointerRef.clientY);
          setClips((prev) =>
            applyClipPositionAndTrimOverlaps(prev, id, newStartSec, finalTrack)
          );
        } else {
          onSelectIfClick?.();
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
              borderColor: subtitleBorderColor,
              highlightTextColor: subtitleHighlightTextColor,
              highlightBgColor: subtitleHighlightBgColor,
              showHighlightedWordOnly: subtitleShowHighlightedWordOnly,
              width: subtitleWidth,
              positionX: subtitlePositionX,
              positionY: subtitlePositionY,
            },
            zoom: (() => {
              const z = parseFloat(globalZoomInput);
              return Number.isFinite(z) && z > 0 ? z : 1;
            })(),
            speed: globalSpeedNum,
          },
        });
        const blob = await getBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "edited-video.mp4";
        a.click();
        URL.revokeObjectURL(url);
        const form = new FormData();
        form.append("file", blob, "exported-video.mp4");
        form.append("projectId", projectId);
        form.append("clipId", "exported-video");
        const saveRes = await fetch("/api/editor-save-blob", {
          method: "POST",
          body: form,
        });
        const saveData = (await saveRes.json()) as { path?: string };
        if (saveData.path) {
          addData(projectId, "exportedVideo", saveData.path);
        }
        setShowExportModal(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Export failed");
      } finally {
        setExporting(false);
      }
    },
    [
      clips,
      durationInFrames,
      projectId,
      subtitleTextSize,
      subtitleTextColor,
      subtitleBgColor,
      subtitleBorderColor,
      subtitleHighlightTextColor,
      subtitleHighlightBgColor,
      subtitleShowHighlightedWordOnly,
      subtitleWidth,
      subtitlePositionX,
      subtitlePositionY,
      globalZoomInput,
      globalSpeedNum,
    ]
  );

  const handleExportAudio = useCallback(async () => {
    if (clips.length === 0) {
      alert("Add at least one clip to export.");
      return;
    }
    setExporting(true);
    try {
      const sorted = [...clips].sort(
        (a, b) => toFinite(a.startTimeSec, 0) - toFinite(b.startTimeSec, 0)
      );
      const first = sorted[0];
      const w =
        first?.width != null && Number.isFinite(first.width) ? first.width : COMP_WIDTH;
      const h =
        first?.height != null && Number.isFinite(first.height) ? first.height : COMP_HEIGHT;

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
            borderColor: subtitleBorderColor,
            highlightTextColor: subtitleHighlightTextColor,
            highlightBgColor: subtitleHighlightBgColor,
            showHighlightedWordOnly: subtitleShowHighlightedWordOnly,
            width: subtitleWidth,
            positionX: subtitlePositionX,
            positionY: subtitlePositionY,
          },
          zoom: (() => {
            const z = parseFloat(globalZoomInput);
            return Number.isFinite(z) && z > 0 ? z : 1;
          })(),
          speed: globalSpeedNum,
        },
      });

      const videoBlob = await getBlob();
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      try {
        const ab = await videoBlob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(ab.slice(0));
        const wavBlob = audioBufferToWavBlob(audioBuffer);

        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "edited-audio.wav";
        a.click();
        URL.revokeObjectURL(url);

        const form = new FormData();
        form.append("file", wavBlob, "exported-audio.wav");
        form.append("projectId", projectId);
        form.append("clipId", "exported-audio");
        const saveRes = await fetch("/api/editor-save-blob", {
          method: "POST",
          body: form,
        });
        const saveData = (await saveRes.json()) as { path?: string };
        if (saveData.path) {
          addData(projectId, "exportedAudio", saveData.path);
        }
      } finally {
        try {
          await ctx.close();
        } catch {
          // ignore
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export audio failed");
    } finally {
      setExporting(false);
    }
  }, [
    clips,
    durationInFrames,
    globalZoomInput,
    globalSpeedNum,
    projectId,
    subtitleTextSize,
    subtitleTextColor,
    subtitleBgColor,
    subtitleBorderColor,
    subtitleHighlightTextColor,
    subtitleHighlightBgColor,
    subtitleShowHighlightedWordOnly,
    subtitleWidth,
    subtitlePositionX,
    subtitlePositionY,
  ]);

  const openExportModal = useCallback(() => {
    const x = parseInt(compWidthInput, 10);
    const y = parseInt(compHeightInput, 10);
    const defW = Number.isFinite(x) && x > 0 ? x : COMP_WIDTH;
    const defH = Number.isFinite(y) && y > 0 ? y : COMP_HEIGHT;
    setExportResX(defW);
    setExportResY(defH);
    setShowExportModal(true);
  }, [compWidthInput, compHeightInput]);

  const selectedClip = clips.find((c) => c.id === selectedClipId);
  const isAudioClipSelected = selectedClip?.kind === "audio" || selectedClip?.kind === "combined";
  const selectedIsVideoForZoom =
    selectedClip != null &&
    (selectedClip.kind === "video" || selectedClip.kind === "combined");

  /** When set, Texts panel edits apply only to this clip; otherwise to all text clips. */
  const selectedTextClipId =
    selectedClip?.kind === "text" && selectedClipId ? selectedClipId : null;

  const globalSubtitleStyleObj: SubtitleStyle = useMemo(
    () => ({
      textSize: subtitleTextSize,
      textColor: subtitleTextColor,
      backgroundColor: subtitleBgColor,
      borderColor: subtitleBorderColor,
      highlightTextColor: subtitleHighlightTextColor,
      highlightBgColor: subtitleHighlightBgColor,
      showHighlightedWordOnly: subtitleShowHighlightedWordOnly,
      width: subtitleWidth,
      positionX: subtitlePositionX,
      positionY: subtitlePositionY,
    }),
    [
      subtitleTextSize,
      subtitleTextColor,
      subtitleBgColor,
      subtitleBorderColor,
      subtitleHighlightTextColor,
      subtitleHighlightBgColor,
      subtitleShowHighlightedWordOnly,
      subtitleWidth,
      subtitlePositionX,
      subtitlePositionY,
    ]
  );

  /** Values shown in Transcribe panel: global defaults, or merged with selected subtitle overrides. */
  const transcribePanelStyle = useMemo((): SubtitleStyle => {
    if (selectedClip?.kind === "subtitle") {
      return mergeSubtitleStyleGlobalAndClip(globalSubtitleStyleObj, selectedClip.subtitleStyle);
    }
    return globalSubtitleStyleObj;
  }, [selectedClip, globalSubtitleStyleObj]);

  const setSubtitleStyleField = useCallback(
    <K extends keyof SubtitleStyle>(key: K, value: SubtitleStyle[K]) => {
      const sel = clips.find((c) => c.id === selectedClipId);
      if (selectedClipId && sel?.kind === "subtitle") {
        setClips((prev) =>
          prev.map((c) =>
            c.id === selectedClipId
              ? { ...c, subtitleStyle: { ...(c.subtitleStyle ?? {}), [key]: value } }
              : c
          )
        );
        return;
      }
      switch (key) {
        case "textSize":
          setSubtitleTextSize(value as number);
          break;
        case "textColor":
          setSubtitleTextColor(value as string);
          break;
        case "backgroundColor":
          setSubtitleBgColor(value as string);
          break;
        case "borderColor":
          setSubtitleBorderColor(value as string);
          break;
        case "highlightTextColor":
          setSubtitleHighlightTextColor(value as string);
          break;
        case "highlightBgColor":
          setSubtitleHighlightBgColor(value as string);
          break;
        case "showHighlightedWordOnly":
          setSubtitleShowHighlightedWordOnly(Boolean(value));
          break;
        case "width":
          setSubtitleWidth(value as number);
          break;
        case "positionX":
          setSubtitlePositionX(value as number);
          break;
        case "positionY":
          setSubtitlePositionY(value as number);
          break;
        default:
          break;
      }
    },
    [selectedClipId, clips]
  );

  useEffect(() => {
    if (selectedClip?.kind !== "text") return;
    setTextFontFamily(selectedClip.fontFamily ?? "sans-serif");
    setTextSizeInput(String(selectedClip.textSize ?? 60));
    setTextColor(selectedClip.textColor ?? "#000000");
    setTextBgColor(selectedClip.textBgColor ?? "#ffffff");
    setTextPositionX(
      selectedClip.textPositionX != null && Number.isFinite(selectedClip.textPositionX)
        ? String(selectedClip.textPositionX)
        : ""
    );
    setTextPositionY(
      selectedClip.textPositionY != null && Number.isFinite(selectedClip.textPositionY)
        ? String(selectedClip.textPositionY)
        : ""
    );
    setTextWidthInput(
      selectedClip.textWidth != null && Number.isFinite(selectedClip.textWidth)
        ? String(selectedClip.textWidth)
        : ""
    );
  }, [
    selectedClipId,
    selectedClip?.kind,
    selectedClip?.fontFamily,
    selectedClip?.textSize,
    selectedClip?.textColor,
    selectedClip?.textBgColor,
    selectedClip?.textPositionX,
    selectedClip?.textPositionY,
    selectedClip?.textWidth,
  ]);

  useEffect(() => {
    const g = parseFloat(globalZoomInput);
    const fallback = Number.isFinite(g) && g > 0 ? g : 1;
    if (selectedIsVideoForZoom && selectedClip) {
      setZoomInput(
        selectedClip.videoZoom != null && Number.isFinite(selectedClip.videoZoom)
          ? String(selectedClip.videoZoom)
          : String(fallback)
      );
    } else {
      setZoomInput(globalZoomInput);
    }
  }, [selectedClipId, selectedIsVideoForZoom, selectedClip?.videoZoom, globalZoomInput]);

  useEffect(() => {
    if (selectedIsVideoForZoom && selectedClip) {
      setVideoPositionXInput(
        selectedClip.videoPositionX != null && Number.isFinite(selectedClip.videoPositionX)
          ? String(selectedClip.videoPositionX)
          : "0"
      );
      setVideoPositionYInput(
        selectedClip.videoPositionY != null && Number.isFinite(selectedClip.videoPositionY)
          ? String(selectedClip.videoPositionY)
          : "0"
      );
    } else {
      setVideoPositionXInput("");
      setVideoPositionYInput("");
    }
  }, [
    selectedClipId,
    selectedIsVideoForZoom,
    selectedClip?.videoPositionX,
    selectedClip?.videoPositionY,
  ]);

  useEffect(() => {
    const g = parseFloat(globalSpeedInput);
    const fallback = Number.isFinite(g) && g > 0.01 ? Math.min(g, 100) : 1;
    if (
      selectedClip &&
      (selectedClip.kind === "video" ||
        selectedClip.kind === "audio" ||
        selectedClip.kind === "combined")
    ) {
      setSpeedInput(
        selectedClip.playbackSpeed != null &&
          Number.isFinite(selectedClip.playbackSpeed)
          ? String(selectedClip.playbackSpeed)
          : String(fallback)
      );
    } else {
      setSpeedInput(globalSpeedInput);
    }
  }, [
    selectedClipId,
    selectedClip?.playbackSpeed,
    selectedClip?.kind,
    globalSpeedInput,
  ]);

  useEffect(() => {
    if (isAudioClipSelected && selectedClip) {
      setVolumeInputValue(String(selectedClip.volume ?? 1));
    } else {
      setVolumeInputValue("");
    }
  }, [selectedClipId, isAudioClipSelected, selectedClip?.volume]);

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = document.activeElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          (target as HTMLElement).isContentEditable)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "c") {
        if (selectedClipId == null) return;
        const toCopy = collectClipsToDuplicate(clips, selectedClipId);
        if (toCopy.length === 0) return;
        e.preventDefault();
        clipsClipboardRef.current = JSON.parse(JSON.stringify(toCopy)) as EditorClip[];
        return;
      }
      if (k === "v") {
        const snap = clipsClipboardRef.current;
        if (!snap || snap.length === 0) return;
        e.preventDefault();
        setClips((prev) => {
          const pasted = duplicateClipsForPaste(snap, prev, globalSpeedNum);
          setSelectedClipId(pasted[0]?.id ?? null);
          return [...prev, ...pasted];
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clips, selectedClipId, globalSpeedNum]);

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
      setSelectedClipId(null);
    },
    [getTimelineX, totalDurationSec, timelinePxPerSec]
  );

  /** On-screen preview matches Transform resolution aspect ratio; scaled down to fit max box. */
  const previewDisplayPx = useMemo(() => {
    const w = parseInt(compWidthInput, 10);
    const h = parseInt(compHeightInput, 10);
    const cw = Number.isFinite(w) && w > 0 ? w : COMP_WIDTH;
    const ch = Number.isFinite(h) && h > 0 ? h : COMP_HEIGHT;
    const scale = Math.min(PREVIEW_DISPLAY_MAX_W / cw, PREVIEW_DISPLAY_MAX_H / ch, 1);
    return {
      width: Math.max(1, Math.round(cw * scale)),
      height: Math.max(1, Math.round(ch * scale)),
    };
  }, [compWidthInput, compHeightInput]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      {/* Preview + Right Panel */}
      <div
        className="flex shrink-0 border-b border-foreground/10 bg-black/40 py-3"
        style={{ minHeight: previewDisplayPx.height + 24 }}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center px-4">
          <div
            className="overflow-hidden rounded-lg bg-black shadow-lg"
            style={{
              width: previewDisplayPx.width,
              height: previewDisplayPx.height,
              flexShrink: 0,
            }}
          >
            <RemotionPlayerPreview
              ref={playerRef}
              clips={clips}
              durationInFrames={durationInFrames}
              subtitleStyle={globalSubtitleStyleObj}
              zoom={(() => {
                const z = parseFloat(globalZoomInput);
                return Number.isFinite(z) && z > 0 ? z : 1;
              })()}
              compWidth={(() => {
                const n = parseInt(compWidthInput, 10);
                return Number.isFinite(n) && n > 0 ? n : undefined;
              })()}
              compHeight={(() => {
                const n = parseInt(compHeightInput, 10);
                return Number.isFinite(n) && n > 0 ? n : undefined;
              })()}
              speed={globalSpeedNum}
            />
          </div>
        </div>
        {/* AI Tools Panel */}
        <div className="w-64 shrink-0 border-l border-foreground/10 overflow-y-auto bg-foreground/[0.02]">
          <div className="border-b border-foreground/10">
            <button
              type="button"
              onClick={() => setTransformOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-foreground/5"
            >
              Transform
              <span className="text-xs text-foreground/40">{transformOpen ? "▾" : "▸"}</span>
            </button>
            {transformOpen && (
              <div className="flex flex-col gap-3 px-3 pb-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">
                    Zoom
                    {selectedIsVideoForZoom ? " (selected clip)" : " (all video clips)"}
                  </span>
                  <input
                    type="text"
                    value={zoomInput}
                    onChange={onTransformZoomChange}
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. 1 or 1.5"
                  />
                </label>
                {selectedIsVideoForZoom && selectedClipId && (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-foreground/50">Position X (px)</span>
                      <input
                        type="text"
                        value={videoPositionXInput}
                        onChange={onVideoPositionXChange}
                        className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                        placeholder="0"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-foreground/50">Position Y (px)</span>
                      <input
                        type="text"
                        value={videoPositionYInput}
                        onChange={onVideoPositionYChange}
                        className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                        placeholder="0"
                      />
                    </label>
                  </>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Resolution X</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={compWidthInput}
                    onChange={(e) => setCompWidthInput(e.target.value)}
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. 1920"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Resolution Y</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={compHeightInput}
                    onChange={(e) => setCompHeightInput(e.target.value)}
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. 1080"
                  />
                </label>
              </div>
            )}
          </div>
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
                {selectedClip?.kind === "subtitle" ? (
                  <p className="text-[10px] leading-snug text-foreground/55">
                    Subtitle clip selected — these settings apply only to this clip. Select nothing or another
                    clip to edit defaults for all subtitles.
                  </p>
                ) : (
                  <p className="text-[10px] leading-snug text-foreground/55">
                    Defaults for all subtitle clips. Select a subtitle block on the timeline to override one clip.
                  </p>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Font size</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={transcribePanelStyle.textSize}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setSubtitleStyleField("textSize", Number.isNaN(n) ? 0 : n);
                    }}
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. 24"
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
                    <span className="w-5 h-5 rounded border border-foreground/30 shrink-0" style={{ backgroundColor: transcribePanelStyle.textColor }} />
                    <span className="font-mono text-xs">{transcribePanelStyle.textColor}</span>
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
                    {transcribePanelStyle.backgroundColor === TRANSPARENT_VALUE ? (
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
                        <span className="w-5 h-5 rounded border border-foreground/30 shrink-0" style={{ backgroundColor: transcribePanelStyle.backgroundColor }} />
                        <span className="font-mono text-xs">{transcribePanelStyle.backgroundColor}</span>
                      </>
                    )}
                  </button>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Border color</span>
                  <button
                    ref={borderColorAnchorRef}
                    type="button"
                    onClick={() => setColorPickerOpen((v) => (v === "border" ? null : "border"))}
                    className="flex items-center gap-2 rounded border border-foreground/20 bg-foreground/5 px-2 py-1.5 text-sm hover:bg-foreground/10"
                  >
                    <span className="w-5 h-5 rounded border border-foreground/30 shrink-0" style={{ backgroundColor: transcribePanelStyle.borderColor }} />
                    <span className="font-mono text-xs">{transcribePanelStyle.borderColor}</span>
                  </button>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Highlight text color</span>
                  <button
                    ref={highlightTextColorAnchorRef}
                    type="button"
                    onClick={() => setColorPickerOpen((v) => (v === "highlightText" ? null : "highlightText"))}
                    className="flex items-center gap-2 rounded border border-foreground/20 bg-foreground/5 px-2 py-1.5 text-sm hover:bg-foreground/10"
                  >
                    <span className="w-5 h-5 rounded border border-foreground/30 shrink-0" style={{ backgroundColor: transcribePanelStyle.highlightTextColor }} />
                    <span className="font-mono text-xs">{transcribePanelStyle.highlightTextColor}</span>
                  </button>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Highlight bg color</span>
                  <button
                    ref={highlightBgColorAnchorRef}
                    type="button"
                    onClick={() => setColorPickerOpen((v) => (v === "highlightBg" ? null : "highlightBg"))}
                    className="flex items-center gap-2 rounded border border-foreground/20 bg-foreground/5 px-2 py-1.5 text-sm hover:bg-foreground/10"
                  >
                    {transcribePanelStyle.highlightBgColor === TRANSPARENT_VALUE ? (
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
                        <span className="w-5 h-5 rounded border border-foreground/30 shrink-0" style={{ backgroundColor: transcribePanelStyle.highlightBgColor }} />
                        <span className="font-mono text-xs">{transcribePanelStyle.highlightBgColor}</span>
                      </>
                    )}
                  </button>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={transcribePanelStyle.showHighlightedWordOnly === true}
                    onChange={(e) => setSubtitleStyleField("showHighlightedWordOnly", e.target.checked)}
                    className="rounded border-foreground/30"
                  />
                  <span className="text-xs text-foreground/80">Show highlighted word only</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Width (px)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={transcribePanelStyle.width}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setSubtitleStyleField("width", Number.isNaN(n) ? 0 : n);
                    }}
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. 800"
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Position (X × Y)</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={transcribePanelStyle.positionX}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!Number.isNaN(n)) setSubtitleStyleField("positionX", Math.max(0, n));
                        else if (e.target.value === "") setSubtitleStyleField("positionX", 0);
                      }}
                      className="flex-1 rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                      placeholder="X"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={transcribePanelStyle.positionY}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!Number.isNaN(n)) setSubtitleStyleField("positionY", Math.max(0, n));
                        else if (e.target.value === "") setSubtitleStyleField("positionY", 0);
                      }}
                      className="flex-1 rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                      placeholder="Y"
                    />
                  </div>
                </div>
                {selectedClip?.kind === "subtitle" && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-foreground/50">Text</span>
                    <textarea
                      rows={3}
                      value={selectedClip.text ?? ""}
                      onChange={(e) => {
                        const id = selectedClipId;
                        if (!id) return;
                        const next = e.target.value;
                        const newTokens = next.trim().split(/\s+/).filter(Boolean);
                        setClips((prev) =>
                          prev.map((c) => {
                            if (c.id !== id) return c;
                            let newWords: { start: number; end: number; text: string }[] | undefined;
                            if (newTokens.length === 0) {
                              newWords = undefined;
                            } else if (c.words?.length === newTokens.length) {
                              newWords = c.words.map((w, i) => ({ ...w, text: newTokens[i] ?? w.text }));
                            } else {
                              const segDur = Math.max(0.01, toFinite(c.trimEndSec, 0) - toFinite(c.trimStartSec, 0));
                              const n = newTokens.length;
                              newWords = newTokens.map((text, j) => ({
                                start: (j / n) * segDur,
                                end: ((j + 1) / n) * segDur,
                                text,
                              }));
                            }
                            return { ...c, text: next, words: newWords };
                          })
                        );
                      }}
                      className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent resize-y min-h-[4rem]"
                      placeholder="Subtitle text"
                    />
                  </label>
                )}
                <ColorPickerPopover
                  isOpen={colorPickerOpen === "text"}
                  value={transcribePanelStyle.textColor}
                  onChange={(v) => setSubtitleStyleField("textColor", v)}
                  onClose={() => setColorPickerOpen(null)}
                  anchorRef={textColorAnchorRef}
                />
                <ColorPickerPopover
                  isOpen={colorPickerOpen === "bg"}
                  value={transcribePanelStyle.backgroundColor}
                  onChange={(v) => setSubtitleStyleField("backgroundColor", v)}
                  onClose={() => setColorPickerOpen(null)}
                  anchorRef={bgColorAnchorRef}
                  allowTransparent
                />
                <ColorPickerPopover
                  isOpen={colorPickerOpen === "border"}
                  value={transcribePanelStyle.borderColor}
                  onChange={(v) => setSubtitleStyleField("borderColor", v)}
                  onClose={() => setColorPickerOpen(null)}
                  anchorRef={borderColorAnchorRef}
                />
                <ColorPickerPopover
                  isOpen={colorPickerOpen === "highlightText"}
                  value={transcribePanelStyle.highlightTextColor}
                  onChange={(v) => setSubtitleStyleField("highlightTextColor", v)}
                  onClose={() => setColorPickerOpen(null)}
                  anchorRef={highlightTextColorAnchorRef}
                />
                <ColorPickerPopover
                  isOpen={colorPickerOpen === "highlightBg"}
                  value={transcribePanelStyle.highlightBgColor}
                  onChange={(v) => setSubtitleStyleField("highlightBgColor", v)}
                  onClose={() => setColorPickerOpen(null)}
                  anchorRef={highlightBgColorAnchorRef}
                  allowTransparent
                />
                <button
                  type="button"
                  onClick={() => void transcribeAll()}
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
                  onClick={() => void cutSilences()}
                  disabled={isCuttingSilences || clips.filter((c) => (c.kind === "audio" || c.kind === "combined") && !c.disabled).length === 0}
                  className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isCuttingSilences ? "Cutting..." : "Cut"}
                </button>
              </div>
            )}
          </div>
          <div className="border-b border-foreground/10">
            <button
              type="button"
              onClick={() => setTextsOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-foreground/5"
            >
              Texts
              <span className="text-xs text-foreground/40">{textsOpen ? "▾" : "▸"}</span>
            </button>
            {textsOpen && (
              <div className="flex flex-col gap-3 px-3 pb-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Font family</span>
                  <select
                    value={textFontFamily}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTextFontFamily(v);
                      setClips((prev) =>
                        applyTextClipStylePatch(prev, { fontFamily: v }, selectedTextClipId)
                      );
                    }}
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="sans-serif">Sans-serif</option>
                    <option value="serif">Serif</option>
                    <option value="monospace">Monospace</option>
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Helvetica">Helvetica</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Text size</span>
                  <input
                    type="text"
                    value={textSizeInput}
                    onChange={(e) => setTextSizeInput(e.target.value)}
                    onBlur={() => {
                      const num = parseFloat(textSizeInput);
                      const size = Number.isFinite(num) && num > 0 ? num : 60;
                      setClips((prev) =>
                        applyTextClipStylePatch(prev, { textSize: size }, selectedTextClipId)
                      );
                    }}
                    placeholder="60"
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Width (px)</span>
                  <input
                    type="text"
                    value={textWidthInput}
                    onChange={(e) => setTextWidthInput(e.target.value)}
                    onBlur={() => {
                      const num = parseFloat(textWidthInput);
                      if (Number.isFinite(num) && num > 0) {
                        setClips((prev) =>
                          applyTextClipStylePatch(prev, { textWidth: num }, selectedTextClipId)
                        );
                      } else {
                        setClips((prev) =>
                          applyTextClipStylePatch(
                            prev,
                            { textWidth: undefined },
                            selectedTextClipId
                          )
                        );
                      }
                    }}
                    placeholder="e.g. 800 (empty = 90% of comp)"
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Text color</span>
                  <button
                    ref={panelTextColorAnchorRef}
                    type="button"
                    onClick={() => setTextPanelColorPickerOpen((v) => (v === "textColor" ? null : "textColor"))}
                    className="flex items-center gap-2 rounded border border-foreground/20 bg-foreground/5 px-2 py-1.5 text-sm hover:bg-foreground/10"
                  >
                    <span className="w-5 h-5 rounded border border-foreground/30 shrink-0" style={{ backgroundColor: textColor }} />
                    <span className="font-mono text-xs">{textColor}</span>
                  </button>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Background color</span>
                  <button
                    ref={panelTextBgColorAnchorRef}
                    type="button"
                    onClick={() => setTextPanelColorPickerOpen((v) => (v === "textBg" ? null : "textBg"))}
                    className="flex items-center gap-2 rounded border border-foreground/20 bg-foreground/5 px-2 py-1.5 text-sm hover:bg-foreground/10"
                  >
                    {textBgColor === TRANSPARENT_VALUE ? (
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
                        <span className="w-5 h-5 rounded border border-foreground/30 shrink-0" style={{ backgroundColor: textBgColor }} />
                        <span className="font-mono text-xs">{textBgColor}</span>
                      </>
                    )}
                  </button>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Position (X × Y)</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={textPositionX}
                      onChange={(e) => setTextPositionX(e.target.value)}
                      onBlur={() => {
                        const n = parseFloat(textPositionX);
                        if (!Number.isFinite(n)) return;
                        setClips((prev) =>
                          applyTextClipStylePatch(prev, { textPositionX: n }, selectedTextClipId)
                        );
                      }}
                      placeholder="X"
                      className="flex-1 min-w-0 rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                    />
                    <span className="text-foreground/50">×</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={textPositionY}
                      onChange={(e) => setTextPositionY(e.target.value)}
                      onBlur={() => {
                        const n = parseFloat(textPositionY);
                        if (!Number.isFinite(n)) return;
                        setClips((prev) =>
                          applyTextClipStylePatch(prev, { textPositionY: n }, selectedTextClipId)
                        );
                      }}
                      placeholder="Y"
                      className="flex-1 min-w-0 rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={selectedClip?.kind === "text" ? (selectedClip.text ?? "") : newTextInput}
                    onChange={(e) => {
                      if (selectedClip?.kind === "text" && selectedClipId) {
                        updateClip(selectedClipId, { text: e.target.value });
                      } else {
                        setNewTextInput(e.target.value);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && selectedClip?.kind !== "text") addTextClip();
                    }}
                    placeholder="Add text..."
                    className="flex-1 min-w-0 rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                  />
                  {selectedClip?.kind !== "text" && (
                    <button
                      type="button"
                      onClick={addTextClip}
                      className="shrink-0 rounded border border-foreground/20 bg-foreground/10 px-3 py-1 text-sm hover:bg-foreground/20"
                      title="Add text clip"
                    >
                      +
                    </button>
                  )}
                </div>
                <ColorPickerPopover
                  isOpen={textPanelColorPickerOpen === "textColor"}
                  value={textColor}
                  onChange={(v) => {
                    setTextColor(v);
                    setClips((prev) =>
                      applyTextClipStylePatch(prev, { textColor: v }, selectedTextClipId)
                    );
                  }}
                  onClose={() => setTextPanelColorPickerOpen(null)}
                  anchorRef={panelTextColorAnchorRef}
                />
                <ColorPickerPopover
                  isOpen={textPanelColorPickerOpen === "textBg"}
                  value={textBgColor}
                  onChange={(v) => {
                    setTextBgColor(v);
                    setClips((prev) =>
                      applyTextClipStylePatch(prev, { textBgColor: v }, selectedTextClipId)
                    );
                  }}
                  onClose={() => setTextPanelColorPickerOpen(null)}
                  anchorRef={panelTextBgColorAnchorRef}
                  allowTransparent
                />
              </div>
            )}
          </div>
          <div className="border-b border-foreground/10">
            <button
              type="button"
              onClick={() => setAudioOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-foreground/5"
            >
              Audio
              <span className="text-xs text-foreground/40">{audioOpen ? "▾" : "▸"}</span>
            </button>
            {audioOpen && (
              <div className="flex flex-col gap-3 px-3 pb-3">
                {isAudioClipSelected && selectedClipId && selectedClip && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-foreground/50">Volume (0–1)</span>
                    <input
                      type="text"
                      value={volumeInputValue}
                      onChange={(e) => setVolumeInputValue(e.target.value)}
                      onBlur={() => {
                        const raw = volumeInputValue.trim();
                        const n = raw === "" ? 1 : parseFloat(raw);
                        const v = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : toFinite(selectedClip.volume, 1);
                        updateClip(selectedClipId, { volume: v });
                        setVolumeInputValue(String(v));
                      }}
                      placeholder="1"
                      className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                    />
                  </label>
                )}
              </div>
            )}
          </div>
          <div className="border-b border-foreground/10">
            <button
              type="button"
              onClick={() => setVideoOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-foreground/5"
            >
              Video
              <span className="text-xs text-foreground/40">{videoOpen ? "▾" : "▸"}</span>
            </button>
            {videoOpen && (
              <div className="flex flex-col gap-3 px-3 pb-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground/50">Speed</span>
                  <input
                    type="text"
                    value={speedInput}
                    onChange={onTransformSpeedChange}
                    placeholder="1"
                    className="w-full rounded border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
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
            <button
              type="button"
              onClick={() => setBreakToolEnabled((v) => !v)}
              className={`rounded border px-3 py-1.5 text-sm ${breakToolEnabled ? "border-accent bg-accent/20 text-accent" : "border-foreground/20 bg-foreground/10 hover:bg-foreground/20"}`}
            >
              Break
            </button>
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
              onClick={handleExportAudio}
              disabled={clips.length === 0 || exporting}
              className="rounded border border-foreground/20 bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20 disabled:opacity-50"
            >
              Export audio
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
                const seenBlob = new Set<string>();
                clips.forEach((c) => {
                  if (c.src.startsWith("blob:") && !seenBlob.has(c.src)) {
                    seenBlob.add(c.src);
                    URL.revokeObjectURL(c.src);
                  }
                });
                setClips([]);
                setSelectedClipId(null);
                setPlayheadTimeSec(0);
                playerRef.current?.seekTo(0);
                saveEditorState(projectId, { clips: [] });
                try {
                  await fetch("/api/editor-clear-saves", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId: projectId }),
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
                const ticks = buildRulerTicks(totalSec);
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
                const breakToolProps = {
                  breakToolEnabled,
                  breakToolHoverClipId,
                  breakToolHoverTimelineSec,
                  onBreakToolMouseMove: handleBreakToolMouseMove,
                  onBreakToolClick: handleBreakToolClick,
                };
                return rows.map((trackIdx) => {
                  const trackClips = clips.filter(
                    (c) => toFinite(c.trackIndex, 0) === trackIdx
                  );
                  return (
                    <div
                      key={`track-${trackIdx}`}
                      role="presentation"
                      onClick={() => setSelectedClipId(null)}
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
                        const rowSpeed =
                          k === "subtitle" || k === "text"
                            ? 1
                            : clipPlaybackSpeed(clip, globalSpeedNum);
                        const slotLeft = `${((clip.startTimeSec ?? 0) - trimOffset / rowSpeed) * timelinePxPerSec}px`;
                        const clipOpacity = clip.disabled ? 0.35 : 1;
                        if (k === "combined") {
                          const trimStart = toFinite(displayClipV.trimStartSec, 0);
                          const trimEnd = toFinite(displayClipV.trimEndSec, 10);
                          const dur = Math.max(0, trimEnd - trimStart);
                          const fullDur = Math.max(dur, toFinite(clip.durationSec, trimEnd || 10));
                          const combSpeed = clipPlaybackSpeed(clip, globalSpeedNum);
                          const slotW = Math.max(24, (fullDur / combSpeed) * timelinePxPerSec);
                          const combSlotLeft = `${((clip.startTimeSec ?? 0) - trimStart / combSpeed) * timelinePxPerSec}px`;
                          return (
                            <div
                              key={clip.id}
                              className="absolute top-0 flex h-full flex-col"
                              style={{ left: combSlotLeft, width: `${slotW}px`, pointerEvents: "none", opacity: clipOpacity }}
                            >
                              <div className="h-1/2 min-h-0 overflow-hidden">
                                <TimelineClipBlock
                                  clip={displayClipV}
                                  globalPlaybackFallback={globalSpeedNum}
                                  pxPerSec={timelinePxPerSec}
                                  isSelected={selectedClipId === clip.id || (clip.linkedClipId != null && selectedClipId === clip.linkedClipId)}
                                  isDragged={draggedId === clip.id}
                                  onSelect={() => setSelectedClipId(clip.id)}
                                  onRemove={() => removeClip(clip.id)}
                                  onMetadataLoaded={(durationSec, w, h) =>
                                    handleClipMetadataLoaded(clip.id, durationSec, w, h)
                                  }
                                  {...blockHandlers(clip, "video")}
                                  {...breakToolProps}
                                />
                              </div>
                              <div className="h-1/2 min-h-0 overflow-hidden">
                                <TimelineAudioBlock
                                  clip={displayClipA}
                                  globalPlaybackFallback={globalSpeedNum}
                                  pxPerSec={timelinePxPerSec}
                                  isSelected={selectedClipId === clip.id || (clip.linkedClipId != null && selectedClipId === clip.linkedClipId)}
                                  isDragged={draggedId === clip.id}
                                  onSelect={() => setSelectedClipId(clip.id)}
                                  onWaveformLoaded={(data) =>
                                    updateClip(clip.id, { waveformData: data })
                                  }
                                  {...blockHandlers(clip, "audio")}
                                  {...breakToolProps}
                                />
                              </div>
                            </div>
                          );
                        }
                        if (k === "subtitle") {
                          const subLeft = `${(clip.startTimeSec ?? 0) * timelinePxPerSec}px`;
                          return (
                            <div
                              key={clip.id}
                              className="absolute top-0 h-full"
                              style={{ left: subLeft, pointerEvents: "none", opacity: clipOpacity }}
                            >
                              <TimelineSubtitleBlock
                                clip={clip}
                                pxPerSec={timelinePxPerSec}
                                isSelected={selectedClipId === clip.id}
                                isDragged={draggedId === clip.id}
                                onSelect={() => setSelectedClipId(clip.id)}
                                onUpdate={(patch) => updateClip(clip.id, patch)}
                                onPositionDragStart={(e) => {
                                  if (e.button === 0)
                                    handlePositionDragStart(
                                      clip.id,
                                      clip.startTimeSec ?? 0,
                                      toFinite(clip.trackIndex, 0),
                                      e.nativeEvent.clientX,
                                      () => setSelectedClipId(clip.id)
                                    );
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setClipContextMenu({ clipId: clip.id, x: e.clientX, y: e.clientY });
                                }}
                                {...breakToolProps}
                              />
                            </div>
                          );
                        }
                        if (k === "text") {
                          const textSlotLeft = `${(clip.startTimeSec ?? 0) * timelinePxPerSec}px`;
                          return (
                            <div
                              key={clip.id}
                              className="absolute top-0 h-full"
                              style={{ left: textSlotLeft, pointerEvents: "none", opacity: clipOpacity }}
                            >
                              <TimelineTextBlock
                                clip={clip}
                                pxPerSec={timelinePxPerSec}
                                isSelected={selectedClipId === clip.id}
                                isDragged={draggedId === clip.id}
                                onSelect={() => setSelectedClipId(clip.id)}
                                onRemove={() => removeClip(clip.id)}
                                onUpdate={(patch) => updateClip(clip.id, patch)}
                                onPositionDragStart={(e) => {
                                  if (e.button === 0)
                                    handlePositionDragStart(
                                      clip.id,
                                      clip.startTimeSec ?? 0,
                                      toFinite(clip.trackIndex, 0),
                                      e.clientX,
                                      () => setSelectedClipId(clip.id)
                                    );
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setClipContextMenu({ clipId: clip.id, x: e.clientX, y: e.clientY });
                                }}
                                {...breakToolProps}
                              />
                            </div>
                          );
                        }
                        if (k === "audio") {
                          return (
                            <div key={clip.id} className="absolute top-0 h-full" style={{ left: slotLeft, pointerEvents: "none", opacity: clipOpacity }}>
                              <TimelineAudioBlock
                                clip={displayClipA}
                                globalPlaybackFallback={globalSpeedNum}
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
                                {...breakToolProps}
                              />
                            </div>
                          );
                        }
                        return (
                          <div key={clip.id} className="absolute top-0 h-full" style={{ left: slotLeft, pointerEvents: "none", opacity: clipOpacity }}>
                            <TimelineClipBlock
                              clip={displayClipV}
                              globalPlaybackFallback={globalSpeedNum}
                              pxPerSec={timelinePxPerSec}
                              isSelected={selectedClipId === clip.id || (clip.linkedClipId != null && selectedClipId === clip.linkedClipId)}
                              isDragged={draggedId === clip.id}
                              onSelect={() => setSelectedClipId(clip.id)}
                              onRemove={() => removeClip(clip.id)}
                              onMetadataLoaded={(durationSec, w, h) =>
                                handleClipMetadataLoaded(clip.id, durationSec, w, h)
                              }
                              {...blockHandlers(clip, "video")}
                              {...breakToolProps}
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
  {
    clips: EditorClip[];
    durationInFrames: number;
    subtitleStyle?: SubtitleStyle;
    zoom?: number;
    speed?: number;
    compWidth?: number;
    compHeight?: number;
  }
>(function RemotionPlayerPreview(
  { clips, durationInFrames, subtitleStyle, zoom, speed, compWidth: compWidthProp, compHeight: compHeightProp },
  ref
) {
  const safeDurationInFrames = Math.max(1, Math.floor(toFinite(durationInFrames, 1)));
  const compWidth = compWidthProp != null && Number.isFinite(compWidthProp) && compWidthProp > 0 ? compWidthProp : toFinite(COMP_WIDTH, 1920);
  const compHeight = compHeightProp != null && Number.isFinite(compHeightProp) && compHeightProp > 0 ? compHeightProp : toFinite(COMP_HEIGHT, 1080);
  const safeStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
  };
  const wrapperStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    minHeight: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  };
  return (
    <div style={wrapperStyle}>
      <RemotionPlayer
        ref={ref as React.Ref<PlayerRefType | null>}
        component={EditorCompositionWithProps}
        inputProps={{
          clips,
          subtitleStyle,
          zoom: zoom ?? 1,
          speed: speed ?? 1,
        }}
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

function TimelineClipBlock({
  clip,
  globalPlaybackFallback,
  pxPerSec,
  isSelected,
  isDragged,
  onSelect,
  onRemove,
  onUpdate,
  onMetadataLoaded,
  onPositionDragStart,
  onContextMenu: onContextMenuProp,
  breakToolEnabled,
  breakToolHoverClipId,
  breakToolHoverTimelineSec,
  onBreakToolMouseMove,
  onBreakToolClick,
}: {
  clip: EditorClip;
  /** Resolved with clip.playbackSpeed for timeline bar width / break tool */
  globalPlaybackFallback?: number;
  pxPerSec: number;
  isSelected: boolean;
  isDragged: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<EditorClip>) => void;
  onMetadataLoaded: (durationSec: number, width?: number, height?: number) => void;
  onPositionDragStart: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  breakToolEnabled?: boolean;
  breakToolHoverClipId?: string | null;
  breakToolHoverTimelineSec?: number;
  onBreakToolMouseMove?: (clipId: string | null, timelineSec: number) => void;
  onBreakToolClick?: (clipId: string, timelineSec: number) => void;
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
  const speed = clipPlaybackSpeed(clip, globalPlaybackFallback);
  const timelineDurSec = durationSec / speed;
  const timelineFullDur = fullDuration / speed;
  const widthPx = Math.max(
    minClipWidthPx,
    Math.min(timelineFullDur * pxPerSec, timelineDurSec * pxPerSec)
  );
  const safeWidth = toFinite(widthPx, minClipWidthPx);
  const wrapperWidthPx = Math.max(safeWidth, toFinite(timelineFullDur * pxPerSec, safeWidth));
  const clipLeftPx =
    fullDuration > 0
      ? (trimStart / fullDuration) * wrapperWidthPx
      : 0;

  const startTimeSec = toFinite(clip.startTimeSec, 0);
  const isHoveredForBreak = breakToolEnabled && breakToolHoverClipId === clip.id;
  const breakLinePx =
    isHoveredForBreak && breakToolHoverTimelineSec != null && timelineDurSec > 0
      ? Math.max(0, Math.min(safeWidth, ((breakToolHoverTimelineSec - startTimeSec) / timelineDurSec) * safeWidth))
      : null;

  const getTimelineSecFromEvent = (e: React.MouseEvent | MouseEvent) => {
    const bar = barRef.current;
    if (!bar || !onBreakToolMouseMove) return 0;
    const rect = bar.getBoundingClientRect();
    // Match TimelineAudioBlock: inner strip is offset by clipLeftPx inside the wide wrapper.
    const localX = e.clientX - rect.left - clipLeftPx;
    const frac = Math.max(0, Math.min(1, localX / safeWidth));
    return startTimeSec + frac * timelineDurSec;
  };

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
        const newStartTimeSec = toFinite(clip.startTimeSec, 0) + delta / speed;
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
  }, [trimDrag, fullDuration, trimStart, trimEnd, onUpdate, speed, clip.startTimeSec]);

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
        onMouseMove={
          breakToolEnabled && onBreakToolMouseMove
            ? (e) => onBreakToolMouseMove(clip.id, getTimelineSecFromEvent(e))
            : undefined
        }
        onMouseLeave={
          breakToolEnabled && onBreakToolMouseMove ? () => onBreakToolMouseMove(null, 0) : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
          if (breakToolEnabled && onBreakToolClick) {
            const sec = getTimelineSecFromEvent(e);
            onBreakToolClick(clip.id, sec);
          } else {
            onSelect();
          }
        }}
        onContextMenu={onContextMenuProp}
        className={`absolute top-0 bottom-0 flex items-center overflow-hidden rounded border-2 cursor-grab active:cursor-grabbing transition ${
          isSelected
            ? "border-accent"
            : "border-foreground/20 hover:border-foreground/30"
        } ${isDragged ? "opacity-50" : ""} ${breakToolEnabled ? "cursor-crosshair" : ""}`}
        style={{
          left: `${clipLeftPx}px`,
          width: `${Math.max(1, safeWidth)}px`,
          pointerEvents: "auto",
        }}
      >
        {breakLinePx != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none z-10"
            style={{ left: `${breakLinePx}px` }}
          />
        )}
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

function TimelineTextBlock({
  clip,
  pxPerSec,
  isSelected,
  isDragged,
  onSelect,
  onRemove,
  onUpdate,
  onPositionDragStart,
  onContextMenu: onContextMenuProp,
  breakToolEnabled,
  breakToolHoverClipId,
  breakToolHoverTimelineSec,
  onBreakToolMouseMove,
  onBreakToolClick,
}: {
  clip: EditorClip;
  pxPerSec: number;
  isSelected: boolean;
  isDragged: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<EditorClip>) => void;
  onPositionDragStart: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  breakToolEnabled?: boolean;
  breakToolHoverClipId?: string | null;
  breakToolHoverTimelineSec?: number;
  onBreakToolMouseMove?: (clipId: string | null, timelineSec: number) => void;
  onBreakToolClick?: (clipId: string, timelineSec: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  /** Delta-based trim: text has no fixed “source length”, so extend/trim by pointer delta (no max). */
  const [trimDrag, setTrimDrag] = useState<{
    side: "left" | "right";
    startClientX: number;
    trimStartAtDrag: number;
    trimEndAtDrag: number;
    startTimeSecAtDrag: number;
  } | null>(null);

  const minClipWidthPx = Math.max(24, 0.1 * pxPerSec);
  const trimStart = toFinite(clip.trimStartSec, 0);
  const trimEnd = toFinite(clip.trimEndSec, DEFAULT_TEXT_CLIP_DURATION_SEC);
  const durationSec = Math.max(MIN_TRIM_DURATION_SEC, trimEnd - trimStart);
  const wrapperWidthPx = Math.max(minClipWidthPx, durationSec * pxPerSec);

  const startTimeSec = toFinite(clip.startTimeSec, 0);
  const isHoveredForBreak = breakToolEnabled && breakToolHoverClipId === clip.id;
  const breakLinePx =
    isHoveredForBreak && breakToolHoverTimelineSec != null && durationSec > 0
      ? Math.max(0, Math.min(wrapperWidthPx, ((breakToolHoverTimelineSec - startTimeSec) / durationSec) * wrapperWidthPx))
      : null;

  const getTimelineSecFromEvent = (e: React.MouseEvent | MouseEvent) => {
    const bar = barRef.current;
    if (!bar || !onBreakToolMouseMove) return 0;
    const rect = bar.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const frac = Math.max(0, Math.min(1, localX / wrapperWidthPx));
    return startTimeSec + frac * durationSec;
  };

  useEffect(() => {
    if (!trimDrag) return;
    const startX = trimDrag.startClientX;
    const t0 = trimDrag.trimStartAtDrag;
    const t1 = trimDrag.trimEndAtDrag;
    const st0 = trimDrag.startTimeSecAtDrag;

    const onMouseMove = (e: MouseEvent) => {
      const dxSec = (e.clientX - startX) / Math.max(0.01, pxPerSec);
      if (trimDrag.side === "left") {
        const newStart = Math.max(
          0,
          Math.min(t1 - MIN_TRIM_DURATION_SEC, t0 + dxSec)
        );
        const delta = newStart - t0;
        onUpdate({ trimStartSec: newStart, startTimeSec: st0 + delta });
      } else {
        const newEnd = Math.max(t0 + MIN_TRIM_DURATION_SEC, t1 + dxSec);
        onUpdate({ trimEndSec: newEnd, durationSec: newEnd });
      }
    };
    const onMouseUp = () => setTrimDrag(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [trimDrag, pxPerSec, onUpdate]);

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
        onMouseMove={
          breakToolEnabled && onBreakToolMouseMove
            ? (e) => onBreakToolMouseMove(clip.id, getTimelineSecFromEvent(e))
            : undefined
        }
        onMouseLeave={
          breakToolEnabled && onBreakToolMouseMove ? () => onBreakToolMouseMove(null, 0) : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
          if (breakToolEnabled && onBreakToolClick) {
            onBreakToolClick(clip.id, getTimelineSecFromEvent(e));
          } else {
            onSelect();
          }
        }}
        onContextMenu={onContextMenuProp}
        className={`absolute inset-0 flex items-center overflow-hidden rounded border-2 cursor-grab active:cursor-grabbing transition ${
          isSelected
            ? "border-accent"
            : "border-foreground/20 hover:border-foreground/30"
        } ${isDragged ? "opacity-50" : ""} ${breakToolEnabled ? "cursor-crosshair" : ""}`}
        style={{
          pointerEvents: "auto",
        }}
      >
        {breakLinePx != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none z-10"
            style={{ left: `${breakLinePx}px` }}
          />
        )}
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
            setTrimDrag({
              side: "left",
              startClientX: e.clientX,
              trimStartAtDrag: trimStart,
              trimEndAtDrag: trimEnd,
              startTimeSecAtDrag: toFinite(clip.startTimeSec, 0),
            });
          }}
        />
        <div
          role="slider"
          aria-label="Trim end"
          className="absolute right-0 inset-y-0 z-10 w-2 cursor-ew-resize border-l border-foreground/30 hover:bg-foreground/20"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTrimDrag({
              side: "right",
              startClientX: e.clientX,
              trimStartAtDrag: trimStart,
              trimEndAtDrag: trimEnd,
              startTimeSecAtDrag: toFinite(clip.startTimeSec, 0),
            });
          }}
        />
      </div>
    </div>
  );
}

function TimelineAudioBlock({
  clip,
  globalPlaybackFallback,
  pxPerSec,
  isSelected,
  isDragged,
  onSelect,
  onUpdate,
  onWaveformLoaded,
  onMetadataLoaded,
  onPositionDragStart,
  onContextMenu: onContextMenuProp,
  breakToolEnabled,
  breakToolHoverClipId,
  breakToolHoverTimelineSec,
  onBreakToolMouseMove,
  onBreakToolClick,
}: {
  clip: EditorClip;
  globalPlaybackFallback?: number;
  pxPerSec: number;
  isSelected: boolean;
  isDragged: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<EditorClip>) => void;
  onWaveformLoaded: (data: number[]) => void;
  onMetadataLoaded?: (durationSec: number) => void;
  onPositionDragStart: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  breakToolEnabled?: boolean;
  breakToolHoverClipId?: string | null;
  breakToolHoverTimelineSec?: number;
  onBreakToolMouseMove?: (clipId: string | null, timelineSec: number) => void;
  onBreakToolClick?: (clipId: string, timelineSec: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Bumps when timeline clip bar resizes so waveform redraws after layout (fixes ch=1 “vertical lines” until volume changes). */
  const [waveformLayoutGen, setWaveformLayoutGen] = useState(0);
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
  const speed = clipPlaybackSpeed(clip, globalPlaybackFallback);
  const timelineDurSec = durationSec / speed;
  const timelineFullDur = fullDuration / speed;
  const minClipWidthPx = Math.max(24, 0.1 * pxPerSec);
  const widthPx = Math.max(
    minClipWidthPx,
    Math.min(timelineFullDur * pxPerSec, timelineDurSec * pxPerSec)
  );
  const safeWidth = toFinite(widthPx, minClipWidthPx);
  const wrapperWidthPx = Math.max(safeWidth, toFinite(timelineFullDur * pxPerSec, safeWidth));
  const clipLeftPx =
    fullDuration > 0 ? (trimStart / fullDuration) * wrapperWidthPx : 0;

  const startTimeSec = toFinite(clip.startTimeSec, 0);
  const isHoveredForBreak = breakToolEnabled && breakToolHoverClipId === clip.id;
  const breakLinePx =
    isHoveredForBreak && breakToolHoverTimelineSec != null && timelineDurSec > 0
      ? Math.max(0, Math.min(safeWidth, ((breakToolHoverTimelineSec - startTimeSec) / timelineDurSec) * safeWidth))
      : null;

  const getTimelineSecFromEvent = (e: React.MouseEvent | MouseEvent) => {
    const bar = barRef.current;
    if (!bar || !onBreakToolMouseMove) return 0;
    const rect = bar.getBoundingClientRect();
    const localX = e.clientX - rect.left - clipLeftPx;
    const frac = Math.max(0, Math.min(1, localX / safeWidth));
    return startTimeSec + frac * timelineDurSec;
  };

  const onWaveformLoadedRef = useRef(onWaveformLoaded);
  onWaveformLoadedRef.current = onWaveformLoaded;
  const decodedForSrcRef = useRef<string | null>(null);
  const loadingForSrcRef = useRef<string | null>(null);
  useEffect(() => {
    if (clip.waveformData?.length && decodedForSrcRef.current === clip.src) return;
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
        onWaveformLoadedRef.current(Array(WAVEFORM_SAMPLES).fill(0));
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
        const newStartTimeSec = toFinite(clip.startTimeSec, 0) + delta / speed;
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
  }, [trimDrag, fullDuration, trimStart, trimEnd, onUpdate, speed, clip.startTimeSec]);

  const waveform = clip.waveformData?.length ? clip.waveformData : EMPTY_WAVEFORM;
  const WAVEFORM_SILENT_EPS = 1e-5;

  useLayoutEffect(() => {
    const barEl = barRef.current;
    if (!barEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setWaveformLayoutGen((g) => g + 1);
    });
    ro.observe(barEl);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(wrapperWidthPx));
    const barClientH = barRef.current?.clientHeight ?? 0;
    const canvasClientH = canvas.clientHeight;
    const parentH = Math.round(rect.height);
    const ch = Math.max(
      1,
      parentH || Math.round(canvasClientH) || Math.round(barClientH) || TRACK_HEIGHT_PX
    );
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const centerY = ch / 2;
    ctx.clearRect(0, 0, cw, ch);
    const silent =
      waveform.length === 0 ||
      waveform.every((w) => !Number.isFinite(w) || w < WAVEFORM_SILENT_EPS);
    if (silent) {
      ctx.strokeStyle = "rgba(59, 130, 246, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(cw, centerY);
      ctx.stroke();
      return;
    }
    const maxBarH = Math.max(1, centerY - 2);
    const vol = Math.max(0, Math.min(1, clip.volume ?? 1));
    const barWidth = Math.max(0.5, cw / waveform.length);
    ctx.fillStyle = "rgba(59, 130, 246, 0.7)";
    waveform.forEach((norm, i) => {
      const barH = Math.max(0, norm) * maxBarH * vol;
      const x = (i / waveform.length) * cw;
      ctx.fillRect(x, centerY - barH, barWidth, barH * 2);
    });
  }, [waveform, wrapperWidthPx, clip.volume, waveformLoading, waveformLayoutGen]);

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
        onMouseMove={
          breakToolEnabled && onBreakToolMouseMove
            ? (e) => onBreakToolMouseMove(clip.id, getTimelineSecFromEvent(e))
            : undefined
        }
        onMouseLeave={
          breakToolEnabled && onBreakToolMouseMove ? () => onBreakToolMouseMove(null, 0) : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
          if (breakToolEnabled && onBreakToolClick) {
            onBreakToolClick(clip.id, getTimelineSecFromEvent(e));
          } else {
            onSelect();
          }
        }}
        onContextMenu={onContextMenuProp}
        className={`absolute top-0 bottom-0 flex items-center overflow-hidden rounded border-2 cursor-grab active:cursor-grabbing transition ${
          isSelected
            ? "border-accent"
            : "border-foreground/20 hover:border-foreground/30"
        } ${isDragged ? "opacity-50" : ""} ${breakToolEnabled ? "cursor-crosshair" : ""}`}
        style={{
          left: `${clipLeftPx}px`,
          width: `${Math.max(1, safeWidth)}px`,
          pointerEvents: "auto",
        }}
      >
        {breakLinePx != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none z-10"
            style={{ left: `${breakLinePx}px` }}
          />
        )}
        <div className="absolute inset-0 bg-foreground/10" />
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
          {waveformLoading && waveform.length === 0 && (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-foreground/50 pointer-events-none">
              Loading…
            </span>
          )}
        </div>
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

function TimelineSubtitleBlock({
  clip,
  pxPerSec,
  isSelected,
  isDragged,
  onSelect,
  onUpdate,
  onPositionDragStart,
  onContextMenu: onContextMenuProp,
  breakToolEnabled,
  breakToolHoverClipId,
  breakToolHoverTimelineSec,
  onBreakToolMouseMove,
  onBreakToolClick,
}: {
  clip: EditorClip;
  pxPerSec: number;
  isSelected: boolean;
  isDragged: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<EditorClip>) => void;
  onPositionDragStart: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  breakToolEnabled?: boolean;
  breakToolHoverClipId?: string | null;
  breakToolHoverTimelineSec?: number;
  onBreakToolMouseMove?: (clipId: string | null, timelineSec: number) => void;
  onBreakToolClick?: (clipId: string, timelineSec: number) => void;
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
  const minClipWidthPx = Math.max(24, 0.1 * pxPerSec);
  const widthPx = Math.max(minClipWidthPx, durationSec * pxPerSec);
  const safeWidth = toFinite(widthPx, minClipWidthPx);
  const wrapperWidthPx = Math.max(safeWidth, safeWidth);

  const startTimeSec = toFinite(clip.startTimeSec, 0);
  const isHoveredForBreak = breakToolEnabled && breakToolHoverClipId === clip.id;
  const breakLinePx =
    isHoveredForBreak && breakToolHoverTimelineSec != null && durationSec > 0
      ? Math.max(0, Math.min(safeWidth, ((breakToolHoverTimelineSec - startTimeSec) / durationSec) * safeWidth))
      : null;

  const getTimelineSecFromEvent = (e: React.MouseEvent | MouseEvent) => {
    const bar = barRef.current;
    if (!bar || !onBreakToolMouseMove) return 0;
    const rect = bar.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const frac = Math.max(0, Math.min(1, localX / safeWidth));
    return startTimeSec + frac * durationSec;
  };

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
  }, [trimDrag, fullDuration, trimStart, trimEnd, onUpdate, clip.startTimeSec]);

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
        onMouseMove={
          breakToolEnabled && onBreakToolMouseMove
            ? (e) => onBreakToolMouseMove(clip.id, getTimelineSecFromEvent(e))
            : undefined
        }
        onMouseLeave={
          breakToolEnabled && onBreakToolMouseMove ? () => onBreakToolMouseMove(null, 0) : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
          if (breakToolEnabled && onBreakToolClick) {
            onBreakToolClick(clip.id, getTimelineSecFromEvent(e));
          } else {
            onSelect();
          }
        }}
        onContextMenu={onContextMenuProp}
        className={`absolute top-0 bottom-0 flex items-center overflow-hidden rounded border-2 cursor-grab active:cursor-grabbing transition ${
          isSelected
            ? "border-accent"
            : "border-green-500/40 hover:border-green-500/60"
        } ${isDragged ? "opacity-50" : ""} ${breakToolEnabled ? "cursor-crosshair" : ""}`}
        style={{
          left: 0,
          width: `${Math.max(1, safeWidth)}px`,
          pointerEvents: "auto",
        }}
      >
        {breakLinePx != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none z-10"
            style={{ left: `${breakLinePx}px` }}
          />
        )}
        <div className="absolute inset-0 bg-green-500/15" />
        <span className="absolute left-1 right-1 top-1/2 -translate-y-1/2 truncate text-[10px] font-medium text-green-300">
          {clip.text}
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
    </div>
  );
}
