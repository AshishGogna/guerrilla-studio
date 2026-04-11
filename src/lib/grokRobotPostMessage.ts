/**
 * Payload shape for `window.postMessage` consumed by the Grok Chrome extension.
 */
export type GrokStartRobotMessage = {
  type: "GROK_START_ROBOT";
  options: {
    aspect: "9:16" | "16:9";
    duration: "6" | "10";
    resolution: "480" | "720";
    mode: "frame_to_video";
    upscale: boolean;
    sessionId: string;
  };
  queue: { prompt: string; imageDataURL: string }[];
  openNewTab: boolean;
};

/** Split stored newline-separated paths into a list. */
export function grokStoredPathsToList(imagePaths: string): string[] {
  return imagePaths
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Split stored prompts: storyboard sync uses `\n\n` between entries; legacy uses single newlines.
 */
export function grokPromptsToLines(prompts: string): string[] {
  const t = prompts.trim();
  if (!t) return [];
  if (/\n{2,}/.test(prompts)) {
    return prompts.split(/\n{2,}/).map((s) => s.replace(/\r\n/g, "\n"));
  }
  return prompts.split(/\r?\n/);
}

export function buildGrokStartRobotMessage(params: {
  aspectRatio?: string;
  duration?: string;
  resolution?: string;
  upscale: boolean;
  sessionId: string;
  /** Use with `dataUrls` when prompts are already split (e.g. storyboard). */
  promptLines?: string[];
  /** Ignored when `promptLines` is provided. */
  prompts?: string;
  dataUrls: string[];
  openNewTab?: boolean;
}): GrokStartRobotMessage {
  const aspect = params.aspectRatio === "9:16" ? "9:16" : "16:9";
  const duration =
    params.duration === "10s" || params.duration === "10" ? "10" : "6";
  const resolution =
    params.resolution === "480p" || params.resolution === "480" ? "480" : "720";
  const lines =
    params.promptLines ??
    grokPromptsToLines(params.prompts ?? "");
  const queue = params.dataUrls.map((imageDataURL, i) => ({
    prompt: (lines[i] ?? "").trim(),
    imageDataURL,
  }));

  return {
    type: "GROK_START_ROBOT",
    options: {
      aspect,
      duration,
      resolution,
      mode: "frame_to_video",
      upscale: params.upscale,
      sessionId: params.sessionId,
    },
    queue,
    openNewTab: params.openNewTab ?? true,
  };
}

export function postGrokStartRobot(message: GrokStartRobotMessage): void {
  if (typeof window === "undefined") return;
  window.postMessage(message, "*");
}

/** Expected MP4 location pattern from the Grok extension (macOS). */
export const GROK_VIDEO_DOWNLOADS_DIR = "/Users/gogna/Downloads";

/**
 * Newline-separated absolute paths:
 * `/Users/gogna/Downloads/{sessionId}-1.mp4` … `{sessionId}-{imageCount}.mp4`
 */
export function buildGrokVideoPathsForSession(sessionId: string, imageCount: number): string {
  const sid = sessionId.trim();
  if (!sid || imageCount < 1) return "";
  const lines: string[] = [];
  for (let i = 1; i <= imageCount; i++) {
    lines.push(`${GROK_VIDEO_DOWNLOADS_DIR}/${sid}-${i}.mp4`);
  }
  return lines.join("\n");
}

/** Extension only needs to send `{ type: "GROK_QUEUE_FINISHED" }`; app uses the Grok node’s data. */
export type GrokQueueFinishedMessage = { type: "GROK_QUEUE_FINISHED" };
