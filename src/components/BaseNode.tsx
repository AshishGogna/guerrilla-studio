"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { NodeProps } from "reactflow";
import { useNodesContext } from "./NodesContext";

export type BaseNodeData = {
  title: string;
  isRenaming?: boolean;
  isPlaying?: boolean;
  onTitleChange?: (nodeId: string, title: string) => void;
  onRenameDone?: () => void;
};

type Props = NodeProps<BaseNodeData> & {
  children?: ReactNode;
  className?: string;
};

export default function BaseNode({ id, data, children, className }: Props) {
  const { playNode, playChain } = useNodesContext();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(data.title);

  useEffect(() => {
    setTitle(data.title);
  }, [data.title]);

  useEffect(() => {
    if (data.isRenaming) setEditing(true);
  }, [data.isRenaming]);

  const commitTitle = useCallback(() => {
    data.onTitleChange?.(id, title.trim() || "Untitled");
    setEditing(false);
    data.onRenameDone?.();
  }, [data, id, title]);

  return (
    <div
      className={[
        "min-w-[220px] rounded-lg border bg-[#171717] px-3 py-2 text-foreground shadow-sm",
        data.isPlaying ? "border-green-500 animate-pulse" : "border-foreground/20",
        className ?? "",
      ].join(" ")}
    >
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitTitle();
            if (e.key === "Escape") {
              setTitle(data.title);
              setEditing(false);
              data.onRenameDone?.();
            }
          }}
          className="nodrag w-full rounded border border-foreground/25 bg-transparent px-1 py-0.5 text-sm font-semibold outline-none"
        />
      ) : (
        // NOTE: no `nodrag` on wrapper; otherwise there is nothing draggable on short nodes.
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-left text-sm font-semibold">{data.title}</div>
          <div className="nodrag flex items-center gap-1">
            <button
              type="button"
              className="rounded p-1 text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
              title="Play"
              aria-label="Play"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                playNode(id);
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <button
              type="button"
              className="rounded p-1 text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
              title="Play chain"
              aria-label="Play chain"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                playChain(id);
              }}
            >
              {/* Fast-forward / sequential play icon */}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
                <path d="M4 6v12l8-6z" />
                <path d="M12 6v12l8-6z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

