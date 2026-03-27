"use client";

import { useEffect, useState } from "react";
import { Handle, Position, type Node, type NodeProps, useReactFlow } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import FullScreenTextModal from "./FullScreenTextModal";
import { generateText } from "@/lib/ai";
import { parseAiResponse, parsePrompt } from "@/lib/textParser";
import { useNodesContext } from "./NodesContext";

export type NodeTextData = BaseNodeData & {
  text: string;
  onTextChange?: (nodeId: string, text: string) => void;
};

export default function NodeText(props: NodeProps<NodeTextData>) {
  const [openFullScreen, setOpenFullScreen] = useState(false);
  const [draftText, setDraftText] = useState(props.data.text ?? "");
  const rf = useReactFlow();
  const { projectId } = useNodesContext();

  useEffect(() => {
    setDraftText(props.data.text ?? "");
  }, [props.data.text]);

  return (
    <>
      <BaseNode
        {...props}
        className="min-w-[440px] border-accent/50"
        onPlayClick={async () => {
          try {
            // Execute only for this node's text.
            const userPrompt = parsePrompt(projectId, draftText);
            const output = await generateText(userPrompt, "", "gpt-5.4");
            parseAiResponse(projectId, output);
          } catch (err) {
            console.error(err);
            alert(err instanceof Error ? err.message : "Play failed");
          }
        }}
      >
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
            onMouseDown={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="nodrag absolute bottom-2 right-2 rounded bg-transparent p-1 text-foreground/80"
            title="Open fullscreen"
            aria-label="Open fullscreen text editor"
            onMouseDown={(e) => e.stopPropagation()}
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
        open={openFullScreen}
        text={draftText}
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
        onClose={() => setOpenFullScreen(false)}
      />
    </>
  );
}

