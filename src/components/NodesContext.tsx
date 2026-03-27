"use client";

import { createContext, useContext } from "react";

type NodesContextValue = {
  projectId: string;
  playNode: (nodeId: string) => void;
  playChain: (nodeId: string) => void;
  runStoryboardAll: () => void;
};

const NodesContext = createContext<NodesContextValue | null>(null);

export function NodesProvider({
  projectId,
  playNode,
  playChain,
  runStoryboardAll,
  children,
}: {
  projectId: string;
  playNode: (nodeId: string) => void;
  playChain: (nodeId: string) => void;
  runStoryboardAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <NodesContext.Provider value={{ projectId, playNode, playChain, runStoryboardAll }}>
      {children}
    </NodesContext.Provider>
  );
}

export function useNodesContext(): NodesContextValue {
  const ctx = useContext(NodesContext);
  if (!ctx) throw new Error("useNodesContext must be used within NodesProvider");
  return ctx;
}

