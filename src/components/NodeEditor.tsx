"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import { registerEditorNodeSelectedFiles } from "@/lib/editorNodeFolderSource";

export type NodeEditorData = BaseNodeData & {
  /** Short summary for the node (file names); actual File objects are in-memory only. */
  clipsSelectionLabel?: string;
  /** @deprecated persisted label from older "folder" UI — shown if clipsSelectionLabel missing */
  clipsFolderLabel?: string;
  cutSilences?: boolean;
  transcribe?: boolean;
};

function summarizeFiles(files: File[]): string {
  if (files.length === 0) return "";
  if (files.length === 1) return files[0].name;
  return `${files[0].name} +${files.length - 1} more`;
}

export default function NodeEditor(props: NodeProps<NodeEditorData>) {
  const { id, data } = props;
  const rf = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cutSilences, setCutSilences] = useState(() => data.cutSilences ?? false);
  const [transcribe, setTranscribe] = useState(() => data.transcribe ?? false);

  useEffect(() => {
    setCutSilences(data.cutSilences ?? false);
    setTranscribe(data.transcribe ?? false);
  }, [data.cutSilences, data.transcribe]);

  const displayLabel =
    data.clipsSelectionLabel?.trim() ||
    data.clipsFolderLabel?.trim() ||
    "";

  const patchNodeData = useCallback(
    (patch: Partial<NodeEditorData>) => {
      rf.setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...(n.data as object), ...patch } } : n
        )
      );
    },
    [id, rf]
  );

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      const list = Array.from(files);
      registerEditorNodeSelectedFiles(id, list);
      patchNodeData({
        clipsSelectionLabel: summarizeFiles(list),
        clipsFolderLabel: undefined,
      });
      e.target.value = "";
    },
    [id, patchNodeData]
  );

  return (
    <BaseNode {...props} className="min-w-[280px] border-foreground/20">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*"
        multiple
        className="sr-only pointer-events-none fixed left-0 top-0 h-0 w-0 opacity-0"
        onChange={onFileInputChange}
      />

      <div className="space-y-3 text-sm">
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Clips</label>
          <button
            type="button"
            className="nodrag w-full rounded border border-foreground/20 bg-foreground/5 px-2 py-1.5 text-left text-foreground/90 hover:bg-foreground/10"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => fileInputRef.current?.click()}
          >
            {displayLabel || "Choose video/audio files…"}
          </button>
          <p className="mt-1 text-xs text-foreground/45">
            Select one or more files. Play uploads them to the editor (same as Upload clips).
          </p>
        </div>

        <label className="nodrag flex cursor-pointer items-center gap-2 text-foreground/90">
          <input
            type="checkbox"
            checked={cutSilences}
            onChange={(e) => {
              const v = e.target.checked;
              setCutSilences(v);
              patchNodeData({ cutSilences: v });
            }}
            className="rounded border-foreground/30"
          />
          <span>Cut silences</span>
        </label>

        <label className="nodrag flex cursor-pointer items-center gap-2 text-foreground/90">
          <input
            type="checkbox"
            checked={transcribe}
            onChange={(e) => {
              const v = e.target.checked;
              setTranscribe(v);
              patchNodeData({ transcribe: v });
            }}
            className="rounded border-foreground/30"
          />
          <span>Transcribe</span>
        </label>
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </BaseNode>
  );
}
