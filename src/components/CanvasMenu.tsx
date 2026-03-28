"use client";

import { useState } from "react";

export type CanvasNodeTypeId =
  | "base"
  | "nodeText"
  | "nodeStoryboard"
  | "nodeEditor"
  | "nodeLabel";

type CanvasMenuProps = {
  x: number;
  y: number;
  nodeTypes: { id: CanvasNodeTypeId; label: string }[];
  onAddNodeType: (type: CanvasNodeTypeId) => void;
  onClose: () => void;
};

export default function CanvasMenu({ x, y, nodeTypes, onAddNodeType, onClose }: CanvasMenuProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Close canvas menu"
        className="fixed inset-0 z-20 cursor-default bg-transparent"
        onClick={onClose}
      />
      <div
        className="fixed z-30 min-w-[160px] rounded border border-foreground/20 bg-[#171717] p-1 shadow-lg"
        style={{ left: x, top: y }}
        onMouseLeave={() => setAddOpen(false)}
      >
        <div className="relative">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm text-foreground/90 hover:bg-foreground/10"
            onMouseEnter={() => setAddOpen(true)}
            onClick={() => setAddOpen((v) => !v)}
          >
            <span>Add Node</span>
            <span className="text-foreground/60">›</span>
          </button>

          {addOpen ? (
            <div
              className="absolute top-0 z-40 ml-1 min-w-[180px] rounded border border-foreground/20 bg-[#171717] p-1 shadow-lg"
              style={{ left: "100%" }}
            >
              {nodeTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="w-full rounded px-3 py-1.5 text-left text-sm text-foreground/90 hover:bg-foreground/10"
                  onClick={() => onAddNodeType(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

