"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import FullScreenTextModal from "./FullScreenTextModal";
import { useNodesContext } from "./NodesContext";
import {
  countPathsInValue,
  joinFilePathsForStorage,
  syncAgenticEditorFileEntriesToData,
  type AgenticEditorFileEntry,
} from "@/lib/agenticEditorDataSync";

export type { AgenticEditorFileEntry };

function fileToStoredPath(file: File): string {
  const f = file as File & { path?: string };
  if (typeof f.path === "string" && f.path.trim()) return f.path.trim();
  return file.name;
}

export type NodeAgenticEditorData = BaseNodeData & {
  prompt: string;
  sessionId?: string;
  outputType?: "fcpxml" | "video";
  /** Key/value rows; value is newline-separated paths (not shown inline — use file button). */
  fileEntries?: AgenticEditorFileEntry[];
  onPromptChange?: (nodeId: string, prompt: string) => void;
  onSessionIdChange?: (nodeId: string, sessionId: string) => void;
  onOutputTypeChange?: (nodeId: string, outputType: "fcpxml" | "video") => void;
  onFileEntriesChange?: (nodeId: string, entries: AgenticEditorFileEntry[]) => void;
};

function normalizeEntries(raw: unknown): AgenticEditorFileEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    if (typeof row === "object" && row !== null) {
      const o = row as Record<string, unknown>;
      return {
        key: typeof o.key === "string" ? o.key : "",
        paths: typeof o.paths === "string" ? o.paths : "",
      };
    }
    return { key: "", paths: "" };
  });
}

export default function NodeAgenticEditor(props: NodeProps<NodeAgenticEditorData>) {
  const [openFullScreen, setOpenFullScreen] = useState(false);
  const [fileInputMounted, setFileInputMounted] = useState(false);
  const [draft, setDraft] = useState(props.data.prompt ?? "");
  const [sessionIdDraft, setSessionIdDraft] = useState(props.data.sessionId ?? "");
  const [outputType, setOutputType] = useState<"fcpxml" | "video">(
    props.data.outputType === "fcpxml" ? "fcpxml" : "video"
  );
  const { selectNode, projectId, playNode, playChain } = useNodesContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Synchronous row index for the file dialog — state updates may not be committed before `click()`. */
  const filePickRowIndexRef = useRef<number | null>(null);
  const lastPersistedKeysRef = useRef<Set<string>>(new Set());

  const entries = normalizeEntries(props.data.fileEntries);
  /** Latest entries for async handlers (file `onChange`); avoids stale `props.data.fileEntries`. */
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const entriesJson = JSON.stringify(entries);

  useEffect(() => {
    lastPersistedKeysRef.current = new Set();
  }, [projectId]);

  useEffect(() => {
    setDraft(props.data.prompt ?? "");
  }, [props.data.prompt]);

  useEffect(() => {
    setSessionIdDraft(props.data.sessionId ?? "");
  }, [props.data.sessionId]);

  useEffect(() => {
    setOutputType(props.data.outputType === "fcpxml" ? "fcpxml" : "video");
  }, [props.data.outputType]);

  useEffect(() => {
    setFileInputMounted(true);
    return () => setFileInputMounted(false);
  }, []);

  const runDataSync = useCallback(
    (list: AgenticEditorFileEntry[]) => {
      syncAgenticEditorFileEntriesToData(projectId, list, lastPersistedKeysRef);
    },
    [projectId]
  );

  /** Initial / external sync when graph loads or entries change from outside. */
  useEffect(() => {
    const list = JSON.parse(entriesJson) as AgenticEditorFileEntry[];
    runDataSync(list);
  }, [projectId, props.id, entriesJson, runDataSync]);

  /**
   * Nodes are controlled by the parent `useNodesState` — do not use `useReactFlow().setNodes`
   * here; it does not update parent state, so fileEntries / prompt would never persist.
   */
  function applyPrompt(next: string) {
    setDraft(next);
    props.data.onPromptChange?.(props.id, next);
  }

  function applySessionId(next: string) {
    setSessionIdDraft(next);
    props.data.onSessionIdChange?.(props.id, next);
  }

  function applyOutputType(next: "fcpxml" | "video") {
    setOutputType(next);
    props.data.onOutputTypeChange?.(props.id, next);
  }

  const patchFileEntries = useCallback(
    (updater: (prev: AgenticEditorFileEntry[]) => AgenticEditorFileEntry[]) => {
      const cur = entriesRef.current;
      const next = updater(cur);
      props.data.onFileEntriesChange?.(props.id, next);
      entriesRef.current = next;
      // Persist immediately (don’t rely only on useEffect + props round-trip).
      runDataSync(next);
    },
    [props.data.onFileEntriesChange, props.id, runDataSync]
  );

  const updateEntry = useCallback(
    (index: number, partial: Partial<AgenticEditorFileEntry>) => {
      patchFileEntries((rows) =>
        rows.map((row, i) => (i === index ? { ...row, ...partial } : row))
      );
    },
    [patchFileEntries]
  );

  const addEntry = useCallback(() => {
    patchFileEntries((rows) => [...rows, { key: "", paths: "" }]);
  }, [patchFileEntries]);

  const removeEntry = useCallback(
    (index: number) => {
      patchFileEntries((rows) => rows.filter((_, i) => i !== index));
    },
    [patchFileEntries]
  );

  const onFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      // `input.files` is a live FileList — clearing `value` empties it. Snapshot first.
      const list = input.files?.length ? Array.from(input.files) : [];
      const idx = filePickRowIndexRef.current;
      filePickRowIndexRef.current = null;
      input.value = "";
      if (idx == null || list.length === 0) {
        console.log("[AgenticEditor] file input change skipped", {
          nodeId: props.id,
          rowIndex: idx,
          fileCount: list.length,
        });
        return;
      }

      // Prefer absolute local paths when available (e.g. Electron: File.path).
      const fileObjs = list as (File & { path?: string })[];
      const hasAllAbsPaths = fileObjs.every((f) => typeof f.path === "string" && f.path.trim());
      let absPaths: string[] = [];
      if (hasAllAbsPaths) {
        absPaths = fileObjs.map((f) => String(f.path).trim());
      } else {
        try {
          const form = new FormData();
          form.set("projectId", projectId);
          list.forEach((f) => form.append("files", f));
          const res = await fetch("/api/agentic-editor-upload", { method: "POST", body: form });
          const data = (await res.json().catch(() => null)) as { absPaths?: unknown; error?: string } | null;
          if (!res.ok) throw new Error(data?.error ?? "Upload failed");
          absPaths = Array.isArray(data?.absPaths)
            ? (data!.absPaths.filter((p): p is string => typeof p === "string" && Boolean(p.trim())) as string[])
            : [];
        } catch (err) {
          console.error(err);
          alert(err instanceof Error ? err.message : "Failed to upload files for absolute paths");
          return;
        }
      }

      const fromPicker = joinFilePathsForStorage(...absPaths);
      console.log("[AgenticEditor] files selected", {
        nodeId: props.id,
        projectId,
        rowIndex: idx,
        count: list.length,
        names: list.map((f) => f.name),
        absPaths,
        fromPickerPreview:
          fromPicker.length > 200 ? `${fromPicker.slice(0, 200)}…` : fromPicker,
      });

      patchFileEntries((rows) =>
        rows.map((r, i) => {
          if (i !== idx) return r;
          return { ...r, paths: fromPicker };
        })
      );
    },
    [patchFileEntries, projectId, props.id]
  );

  const openFilePickerForRow = useCallback((rowIndex: number) => {
    filePickRowIndexRef.current = rowIndex;
    // Defer until after React commits; microtask can run before `filePickRowIndex` state would be reliable.
    window.setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  }, []);

  return (
    <>
      <BaseNode {...props} className="min-w-[440px]">
        <label className="mb-1 block text-xs font-medium text-foreground/60">Prompt</label>
        <div className="relative mb-4">
          <textarea
            className="nodrag nowheel min-h-[184px] w-full resize-none rounded border border-foreground/15 bg-foreground/[0.04] px-2 py-2 pr-8 text-sm text-foreground/90 outline-none focus:border-foreground/30"
            placeholder="Prompt…"
            value={draft}
            onChange={(e) => applyPrompt(e.target.value)}
            onMouseDown={(e) => {
              e.stopPropagation();
              selectNode(props.id, e);
            }}
          />
          <button
            type="button"
            className="nodrag absolute bottom-2 right-2 rounded bg-transparent p-1 text-foreground/80"
            title="Open fullscreen"
            aria-label="Open fullscreen prompt editor"
            onMouseDown={(e) => {
              e.stopPropagation();
              selectNode(props.id, e);
            }}
            onClick={(e) => {
              e.stopPropagation();
              setOpenFullScreen(true);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M8 3H3v5" />
              <path d="M16 3h5v5" />
              <path d="M3 16v5h5" />
              <path d="M21 16v5h-5" />
            </svg>
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-foreground/60">Session id</label>
        <input
          className="nodrag mb-4 w-full rounded border border-foreground/15 bg-foreground/[0.04] px-2 py-2 text-sm text-foreground/90 outline-none focus:border-foreground/30"
          placeholder="abcdef"
          value={sessionIdDraft}
          onChange={(e) => applySessionId(e.target.value)}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(props.id, e);
          }}
        />

        <label className="mb-1 block text-xs font-medium text-foreground/60">Output type</label>
        <select
          className="nodrag mb-4 w-full rounded border border-foreground/15 bg-foreground/[0.04] px-2 py-2 text-sm text-foreground/90 outline-none focus:border-foreground/30"
          value={outputType}
          onChange={(e) => applyOutputType(e.target.value === "fcpxml" ? "fcpxml" : "video")}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(props.id, e);
          }}
        >
          <option value="fcpxml">fcpxml</option>
          <option value="video">video</option>
        </select>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground/60">Files</span>
            <button
              type="button"
              className="nodrag rounded border border-foreground/25 bg-foreground/5 px-2 py-0.5 text-xs text-foreground/90 hover:bg-foreground/10"
              onMouseDown={(e) => {
                e.stopPropagation();
                selectNode(props.id, e);
              }}
              onClick={(e) => {
                e.stopPropagation();
                addEntry();
              }}
            >
              +
            </button>
          </div>

          {entries.length === 0 ? (
            <p className="text-xs text-foreground/45">No rows yet. Click &quot;+ Add row&quot;.</p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((row, index) => {
                const n = countPathsInValue(row.paths);
                return (
                  <li key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      className="nodrag min-w-0 flex-1 rounded border border-foreground/20 bg-background px-2 py-1.5 text-sm text-foreground outline-none"
                      value={row.key}
                      placeholder="Key…"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        selectNode(props.id, e);
                      }}
                      onChange={(e) => updateEntry(index, { key: e.target.value })}
                    />
                    <button
                      type="button"
                      className="nodrag shrink-0 rounded border border-foreground/20 bg-foreground/5 px-2 py-1.5 text-sm text-foreground/90 hover:bg-foreground/10"
                      title={row.paths ? row.paths.replace(/\n/g, " · ") : "Select files"}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        selectNode(props.id, e);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openFilePickerForRow(index);
                      }}
                    >
                      {n > 0 ? `${n} file${n === 1 ? "" : "s"}` : "Files…"}
                    </button>
                    <button
                      type="button"
                      className="nodrag shrink-0 rounded p-1.5 text-foreground/55 hover:bg-red-500/15 hover:text-red-300"
                      title="Remove row"
                      aria-label="Remove row"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        selectNode(props.id, e);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeEntry(index);
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </BaseNode>
      <FullScreenTextModal
        nodeId={props.id}
        open={openFullScreen}
        promptOnly
        promptOnlyShowPlay
        text={draft}
        outputText=""
        outputRevision={0}
        isAiLoading={props.data.isPlaying === true}
        onChange={(value) => applyPrompt(value)}
        onOutputChange={() => {}}
        onPlay={() => playNode(props.id)}
        onPlayChain={() => playChain(props.id)}
        onClose={() => setOpenFullScreen(false)}
      />
      {fileInputMounted && typeof document !== "undefined"
        ? createPortal(
            <input
              ref={fileInputRef}
              type="file"
              multiple
              tabIndex={-1}
              aria-hidden
              className="fixed left-0 top-0 z-[300] m-0 p-0 opacity-0"
              style={{ width: "1px", height: "1px" }}
              onChange={onFileInputChange}
            />,
            document.body
          )
        : null}
    </>
  );
}
