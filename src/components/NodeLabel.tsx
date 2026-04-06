"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { NodeProps } from "reactflow";
import { useNodesContext } from "./NodesContext";

const DEFAULT_W = 160;
const DEFAULT_H = 44;
const DEFAULT_FONT_PX = 14;
const MIN_H = 28;

export type NodeLabelData = {
  label: string;
  /** Width at default font size (14px); rendered width scales with fontSizePx */
  width?: number;
  height?: number;
  /** Text size in CSS px */
  fontSizePx?: number;
  /** Injected by canvas */
  isRenaming?: boolean;
  onLabelChange?: (nodeId: string, label: string) => void;
  onRenameDone?: () => void;
};

export default function NodeLabel({ id, data, selected }: NodeProps<NodeLabelData>) {
  const { selectNode } = useNodesContext();
  const label = data.label ?? "Label";
  const baseWidth = typeof data.width === "number" && data.width > 0 ? data.width : DEFAULT_W;
  const height = typeof data.height === "number" && data.height > 0 ? data.height : DEFAULT_H;
  const fontSizePx =
    typeof data.fontSizePx === "number" && data.fontSizePx > 0 ? data.fontSizePx : DEFAULT_FONT_PX;
  /** Wider type → wider box; height stays from `height` only */
  const displayWidth = Math.max(48, Math.round(baseWidth * (fontSizePx / DEFAULT_FONT_PX)));

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  useEffect(() => {
    setDraft(label);
  }, [label]);

  useEffect(() => {
    if (data.isRenaming) setEditing(true);
  }, [data.isRenaming]);

  const commitLabel = useCallback(() => {
    const next = draft.trim() || "Label";
    data.onLabelChange?.(id, next);
    setEditing(false);
    data.onRenameDone?.();
  }, [data, id, draft]);

  const textStyle: CSSProperties = {
    fontSize: fontSizePx,
    lineHeight: 1.35,
  };

  return (
    <div
      className={[
        "cursor-grab select-none font-medium text-foreground active:cursor-grabbing",
        selected ? "text-accent" : "text-foreground/90",
      ].join(" ")}
      style={{
        width: displayWidth,
        minHeight: height,
        boxSizing: "border-box",
        ...textStyle,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        selectNode(id, e);
        setEditing(true);
      }}
    >
      {editing ? (
        <textarea
          autoFocus
          className="nodrag nowheel h-full min-h-[28px] w-full resize-none bg-transparent text-inherit outline-none placeholder:text-foreground/40"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(id, e);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(label);
              setEditing(false);
              data.onRenameDone?.();
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitLabel();
            }
          }}
          style={{
            ...textStyle,
            minHeight: Math.max(MIN_H, height - 4),
          }}
        />
      ) : (
        <div className="whitespace-pre-wrap break-words" style={textStyle}>
          {label}
        </div>
      )}
    </div>
  );
}
