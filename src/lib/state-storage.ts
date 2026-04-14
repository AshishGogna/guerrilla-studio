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
  promptImage: string;
  promptVideo: string;
  mode: "image" | "video";
  referenceImages: { url: string }[];
  referenceDataKeys?: string[];
}

export interface StoryboardStatePersisted {
  imageModel: string;
  aspectRatio: string;
  scale: string;
  panels: StoryboardPanelPersisted[];
}

const STORYBOARD_SCOPE = "storyboard";
const DEFAULT_STORYBOARD: StoryboardStatePersisted = {
  imageModel: "gemini-2.5-flash-image",
  aspectRatio: "16:9",
  scale: "1x",
  panels: [
    {
      imageUrl: null,
      promptImage: "",
      promptVideo: "",
      mode: "image",
      referenceImages: [],
    },
  ],
};

export function loadStoryboardState(projectId: string): StoryboardStatePersisted {
  const loaded = loadState<Partial<StoryboardStatePersisted> & { panels?: StoryboardPanelPersisted[] }>(
    STORYBOARD_SCOPE,
    projectId,
    {}
  );
  return {
    imageModel: loaded.imageModel ?? DEFAULT_STORYBOARD.imageModel,
    aspectRatio: loaded.aspectRatio ?? DEFAULT_STORYBOARD.aspectRatio,
    scale: loaded.scale ?? DEFAULT_STORYBOARD.scale,
    panels: loaded.panels?.length ? loaded.panels : DEFAULT_STORYBOARD.panels,
  };
}

export function saveStoryboardState(
  projectId: string,
  state: StoryboardStatePersisted
): void {
  saveState(STORYBOARD_SCOPE, projectId, state);
}
