/**
 * Persist storyboard state. All image fields are file URLs (paths) only, no blobs.
 */

const STORAGE_PREFIX = "guerrilla-studio:state";

function getKey(scope: string, projectId: string): string {
  return `${STORAGE_PREFIX}:${scope}:${projectId}`;
}

export function loadState<T>(scope: string, projectId: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = localStorage.getItem(getKey(scope, projectId));
    if (raw == null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function saveState<T>(scope: string, projectId: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getKey(scope, projectId), JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export interface StoryboardPanelPersisted {
  imageUrl: string | null;
  prompt: string;
  mode: "image" | "video";
  imageModel: string;
  referenceImages: { url: string }[];
}

export interface StoryboardStatePersisted {
  panels: StoryboardPanelPersisted[];
}

const STORYBOARD_SCOPE = "storyboard";
const DEFAULT_STORYBOARD: StoryboardStatePersisted = {
  panels: [
    {
      imageUrl: null,
      prompt: "",
      mode: "image",
      imageModel: "gemini-2.5-flash-image",
      referenceImages: [],
    },
  ],
};

export function loadStoryboardState(projectId: string): StoryboardStatePersisted {
  return loadState(STORYBOARD_SCOPE, projectId, DEFAULT_STORYBOARD);
}

export function saveStoryboardState(
  projectId: string,
  state: StoryboardStatePersisted
): void {
  saveState(STORYBOARD_SCOPE, projectId, state);
}
