"use client";

import { createContext, useContext } from "react";

type NodesContextValue = {
  projectId: string;
  playNode: (nodeId: string) => void;
  playChain: (nodeId: string) => void;
};

const NodesContext = createContext<NodesContextValue | null>(null);

export function NodesProvider({
  projectId,
  playNode,
  playChain,
  children,
}: {
  projectId: string;
  playNode: (nodeId: string) => void;
  playChain: (nodeId: string) => void;
  children: React.ReactNode;
}) {
  return <NodesContext.Provider value={{ projectId, playNode, playChain }}>{children}</NodesContext.Provider>;
}

export function useNodesContext(): NodesContextValue {
  const ctx = useContext(NodesContext);
  if (!ctx) throw new Error("useNodesContext must be used within NodesProvider");
  return ctx;
}

