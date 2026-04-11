export const STORYBOARD_STATE_CHANGED_EVENT = "guerrilla-studio:storyboard-state-changed";

export type StoryboardStateChangedDetail = {
  projectId: string;
  /** When false, Storyboarding tab does not reload from storage (avoids feedback loops). Other listeners still run. */
  refreshStoryboardUi?: boolean;
};

export function notifyStoryboardStateChanged(
  projectId: string,
  opts?: { refreshStoryboardUi?: boolean }
): void {
  if (typeof window === "undefined") return;
  const detail: StoryboardStateChangedDetail = {
    projectId,
    refreshStoryboardUi: opts?.refreshStoryboardUi !== false,
  };
  window.dispatchEvent(
    new CustomEvent(STORYBOARD_STATE_CHANGED_EVENT, { detail })
  );
}

