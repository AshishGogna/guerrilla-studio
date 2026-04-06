"use client";

import { useEffect, useState } from "react";
import { Handle, Position, type Node, type NodeProps, useReactFlow } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import FullScreenTextModal from "./FullScreenTextModal";
import { useNodesContext } from "./NodesContext";

export type NodeTextData = BaseNodeData & {
  text: string;
  /** Raw model output from the last successful (or failed) Play on this node. */
  lastAiOutput?: string;
  /** Incremented when Play writes a new `lastAiOutput` so fullscreen can refresh without breaking caret while typing. */
  aiOutputRevision?: number;
  onTextChange?: (nodeId: string, text: string) => void;
};

export default function NodeText(props: NodeProps<NodeTextData>) {
  const [openFullScreen, setOpenFullScreen] = useState(false);
  const [draftText, setDraftText] = useState(props.data.text ?? "");
  const rf = useReactFlow();
  const { playNode, playChain, selectNode } = useNodesContext();

  useEffect(() => {
    setDraftText(props.data.text ?? "");
  }, [props.data.text]);

  return (
    <>
      <BaseNode {...props} className="min-w-[440px]">
        <div className="relative">
          <textarea
            className="nodrag nowheel min-h-[184px] w-full resize-none rounded bg-transparent pr-0 text-sm text-foreground/90 outline-none"
            value={draftText}
            onChange={(e) => {
              const next = e.target.value;
              setDraftText(next);
              // Prefer updating React Flow state directly so persistence always works,
              // even if callback fields were stripped/re-hydrated.
              rf.setNodes((prev) =>
                prev.map((n: Node<Record<string, unknown>>) =>
                  n.id === props.id
                    ? { ...n, data: { ...(n.data as Record<string, unknown>), text: next } }
                    : n
                )
              );
              props.data.onTextChange?.(props.id, next);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              selectNode(props.id, e);
            }}
          />
          <button
            type="button"
            className="nodrag absolute bottom-2 right-2 rounded bg-transparent p-1 text-foreground/80"
            title="Open fullscreen"
            aria-label="Open fullscreen text editor"
            onMouseDown={(e) => {
              e.stopPropagation();
              selectNode(props.id, e);
            }}
            onClick={(e) => {
              e.stopPropagation();
              setOpenFullScreen(true);
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M8 3H3v5" />
              <path d="M16 3h5v5" />
              <path d="M3 16v5h5" />
              <path d="M21 16v5h-5" />
            </svg>
          </button>
        </div>
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </BaseNode>
      <FullScreenTextModal
        nodeId={props.id}
        open={openFullScreen}
        text={draftText}
        outputText={props.data.lastAiOutput ?? ""}
        outputRevision={props.data.aiOutputRevision ?? 0}
        isAiLoading={props.data.isPlaying === true}
        onChange={(value) => {
          setDraftText(value);
          rf.setNodes((prev) =>
            prev.map((n: Node<Record<string, unknown>>) =>
              n.id === props.id
                ? { ...n, data: { ...(n.data as Record<string, unknown>), text: value } }
                : n
            )
          );
          props.data.onTextChange?.(props.id, value);
        }}
        onOutputChange={(value) => {
          rf.setNodes((prev) =>
            prev.map((n: Node<Record<string, unknown>>) =>
              n.id === props.id
                ? { ...n, data: { ...(n.data as Record<string, unknown>), lastAiOutput: value } }
                : n
            )
          );
        }}
        onPlay={() => playNode(props.id)}
        onPlayChain={() => playChain(props.id)}
        onClose={() => setOpenFullScreen(false)}
      />
    </>
  );
}

