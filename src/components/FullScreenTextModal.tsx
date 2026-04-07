"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyResolvedPromptToClipboard } from "@/lib/textParser";
import { useNodesContext } from "./NodesContext";

function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

/**
 * Local output while modal is open avoids caret jumps on every parent `setNodes`.
 * `outputRevision` bumps only when Play (or error) assigns a new `lastAiOutput` so we
 * re-sync from the server without tying to arbitrary prop churn.
 */
function useSyncedOutputWhileOpen(
  open: boolean,
  outputText: string,
  outputRevision: number
) {
  const [localOutput, setLocalOutput] = useState(outputText);
  const outputTextRef = useRef(outputText);
  outputTextRef.current = outputText;

  useEffect(() => {
    if (!open) return;
    setLocalOutput(outputTextRef.current);
  }, [open, outputRevision]);

  return [localOutput, setLocalOutput] as const;
}

type FullScreenTextModalProps = {
  nodeId: string;
  open: boolean;
  text: string;
  /**
   * Single full-width prompt editor only (e.g. Agentic Editor). Hides AI output pane and Play controls.
   */
  promptOnly?: boolean;
  /** When `promptOnly`, still show Play / Play chain (e.g. Agentic Editor → agentic-edit API). */
  promptOnlyShowPlay?: boolean;
  outputText: string;
  /** Bumps when this node's AI output is replaced by Play (see NodeTextData.aiOutputRevision). */
  outputRevision: number;
  /** True while this text node's Play / generate is in flight (`data.isPlaying`). */
  isAiLoading?: boolean;
  onChange: (value: string) => void;
  onOutputChange: (value: string) => void;
  onPlay: () => void;
  onPlayChain: () => void;
  onClose: () => void;
};

export default function FullScreenTextModal({
  nodeId,
  open,
  text,
  promptOnly = false,
  promptOnlyShowPlay = false,
  outputText,
  outputRevision,
  isAiLoading = false,
  onChange,
  onOutputChange,
  onPlay,
  onPlayChain,
  onClose,
}: FullScreenTextModalProps) {
  const { selectNode, projectId } = useNodesContext();
  const [mounted, setMounted] = useState(false);
  const backdropPointerDownRef = useRef(false);
  const [localOutput, setLocalOutput] = useSyncedOutputWhileOpen(
    open,
    outputText,
    outputRevision
  );

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onMouseDown={(e) => {
        backdropPointerDownRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (backdropPointerDownRef.current && e.target === e.currentTarget) {
          onClose();
        }
        backdropPointerDownRef.current = false;
      }}
    >
      <div
        className="flex h-[85vh] w-[min(96vw,1200px)] flex-col overflow-hidden rounded-lg border border-foreground/20 bg-[#171717]"
        onMouseDown={() => {
          backdropPointerDownRef.current = false;
        }}
      >
        <div className={`flex min-h-0 flex-1 p-3 ${promptOnly ? "" : "gap-3"}`}>
          <div
            className={`relative flex min-h-0 flex-col ${promptOnly ? "w-full" : "min-w-0 flex-1"}`}
          >
            <textarea
              className="min-h-0 w-full flex-1 resize-none rounded bg-transparent p-2 text-sm text-foreground outline-none"
              value={text}
              onMouseDown={(e) => {
                e.stopPropagation();
                selectNode(nodeId, e);
              }}
              onChange={(e) => onChange(e.target.value)}
              placeholder={promptOnly ? "Prompt…" : "Prompt / instructions…"}
            />
            <div className="pointer-events-none absolute bottom-2 right-2 flex gap-1">
              <button
                type="button"
                disabled={!promptOnly && isAiLoading}
                className="pointer-events-auto rounded p-1 text-foreground/70 hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                title="Copy resolved prompt (${…} replaced from project data)"
                aria-label="Copy resolved prompt"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  selectNode(nodeId, e);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyResolvedPromptToClipboard(projectId, text);
                }}
              >
                <CopyIcon />
              </button>
              {!promptOnly || promptOnlyShowPlay ? (
                <>
                  <button
                    type="button"
                    disabled={isAiLoading}
                    className="pointer-events-auto rounded p-1 text-foreground/70 hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    title="Play"
                    aria-label="Play"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      selectNode(nodeId, e);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlay();
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    disabled={isAiLoading}
                    className="pointer-events-auto rounded p-1 text-foreground/70 hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    title="Play chain"
                    aria-label="Play chain"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      selectNode(nodeId, e);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayChain();
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
                      <path d="M4 6v12l8-6z" />
                      <path d="M12 6v12l8-6z" />
                    </svg>
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {promptOnly ? null : (
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {isAiLoading ? (
                <div
                  className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded border border-foreground/10 bg-foreground/[0.04] px-4"
                  aria-busy
                  aria-live="polite"
                >
                  <div
                    className="h-9 w-9 shrink-0 animate-spin rounded-full border-2 border-foreground/25 border-t-foreground/70"
                    role="status"
                  />
                  <p className="text-center text-sm text-foreground/60">Generating response…</p>
                </div>
              ) : (
                <textarea
                  className="min-h-0 min-w-0 flex-1 resize-none rounded border border-foreground/10 bg-foreground/[0.04] p-2 text-sm text-foreground/90 outline-none"
                  value={localOutput}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    selectNode(nodeId, e);
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLocalOutput(v);
                    onOutputChange(v);
                  }}
                  placeholder="AI output (editable; saved on change)…"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
