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

/** One array entry per line (including trailing empty lines if present). */
export function grokPromptsToLines(prompts: string): string[] {
  return prompts.split(/\r?\n/);
}

export function buildGrokStartRobotMessage(params: {
  aspectRatio?: string;
  duration?: string;
  resolution?: string;
  upscale: boolean;
  sessionId: string;
  prompts: string;
  dataUrls: string[];
  openNewTab?: boolean;
}): GrokStartRobotMessage {
  const aspect = params.aspectRatio === "9:16" ? "9:16" : "16:9";
  const duration =
    params.duration === "10s" || params.duration === "10" ? "10" : "6";
  const resolution =
    params.resolution === "480p" || params.resolution === "480" ? "480" : "720";
  const lines = grokPromptsToLines(params.prompts);
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
