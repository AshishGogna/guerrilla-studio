export const EDITOR_NODE_PLAY_EVENT = "guerrilla-editor-node-play";

export type EditorNodePlayDetail = {
  projectId: string;
  nodeId: string;
  /** After upload: run Editor "Cut silences" when true */
  cutSilences?: boolean;
  /** After upload (and optional cut silences): run "Transcribe all" when true */
  transcribe?: boolean;
  resolve: () => void;
  reject: (err: Error) => void;
};

export type EditorNodePlayOptions = {
  cutSilences?: boolean;
  transcribe?: boolean;
};

/**
 * Ask the Editor (kept mounted off-tab in TopTabs) to clear the timeline and upload clips
 * from the node's selected files. Does not change the active tab.
 */
export function requestEditorNodePlay(
  projectId: string,
  nodeId: string,
  timeoutMs = 60_000,
  options?: EditorNodePlayOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(
        new Error(
          "Editor did not respond in time. Reload the page or open Video Editing once to initialize the editor."
        )
      );
    }, timeoutMs);

    const finish = (ok: boolean, err?: Error) => {
      window.clearTimeout(timer);
      if (ok) resolve();
      else reject(err ?? new Error("Editor play failed"));
    };

    window.dispatchEvent(
      new CustomEvent<EditorNodePlayDetail>(EDITOR_NODE_PLAY_EVENT, {
        detail: {
          projectId,
          nodeId,
          cutSilences: options?.cutSilences === true,
          transcribe: options?.transcribe === true,
          resolve: () => finish(true),
          reject: (e) => finish(false, e),
        },
      })
    );
  });
}
