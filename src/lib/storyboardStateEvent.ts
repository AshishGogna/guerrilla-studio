export const STORYBOARD_STATE_CHANGED_EVENT = "guerrilla-studio:storyboard-state-changed";

export function notifyStoryboardStateChanged(projectId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(STORYBOARD_STATE_CHANGED_EVENT, { detail: { projectId } })
  );
}

