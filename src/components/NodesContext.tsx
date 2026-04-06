"use client";

import { createContext, useContext, type MouseEvent } from "react";

type NodesContextValue = {
  projectId: string;
  playNode: (nodeId: string) => void;
  playChain: (nodeId: string) => void;
  /** Mark any node as "playing" (e.g. pulse border) — used by Storyboard node during run-all. */
  setNodePlaying: (nodeId: string, playing: boolean) => void;
  /**
   * Select this node (white border). Use when clicking nodrag controls so RF selection updates.
   * With Meta/Ctrl, adds to selection like the canvas multi-select key.
   */
  selectNode: (nodeId: string, event?: MouseEvent) => void;
};

const NodesContext = createContext<NodesContextValue | null>(null);

export function NodesProvider({
  projectId,
  playNode,
  playChain,
  setNodePlaying,
  selectNode,
  children,
}: {
  projectId: string;
  playNode: (nodeId: string) => void;
  playChain: (nodeId: string) => void;
  setNodePlaying: (nodeId: string, playing: boolean) => void;
  selectNode: (nodeId: string, event?: MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <NodesContext.Provider
      value={{ projectId, playNode, playChain, setNodePlaying, selectNode }}
    >
      {children}
    </NodesContext.Provider>
  );
}

export function useNodesContext(): NodesContextValue {
  const ctx = useContext(NodesContext);
  if (!ctx) throw new Error("useNodesContext must be used within NodesProvider");
  return ctx;
}
