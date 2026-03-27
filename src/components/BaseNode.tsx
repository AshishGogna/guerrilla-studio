"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { NodeProps } from "reactflow";

export type BaseNodeData = {
  title: string;
  isRenaming?: boolean;
  onTitleChange?: (nodeId: string, title: string) => void;
  onRenameDone?: () => void;
};

type Props = NodeProps<BaseNodeData> & {
  children?: ReactNode;
  className?: string;
};

export default function BaseNode({ id, data, children, className }: Props) {
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
        "min-w-[220px] rounded-lg border border-foreground/20 bg-[#171717] px-3 py-2 text-foreground shadow-sm",
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
        // NOTE: no `nodrag` here; otherwise there is nothing draggable on short nodes.
        <div className="text-left text-sm font-semibold">{data.title}</div>
      )}

      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

