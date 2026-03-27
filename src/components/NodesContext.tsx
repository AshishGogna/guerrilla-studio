"use client";

import { createContext, useContext } from "react";

type NodesContextValue = { projectId: string };

const NodesContext = createContext<NodesContextValue | null>(null);

export function NodesProvider({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  return <NodesContext.Provider value={{ projectId }}>{children}</NodesContext.Provider>;
}

export function useNodesContext(): NodesContextValue {
  const ctx = useContext(NodesContext);
  if (!ctx) throw new Error("useNodesContext must be used within NodesProvider");
  return ctx;
}

