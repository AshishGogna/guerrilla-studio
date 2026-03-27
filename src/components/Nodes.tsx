"use client";

import ReactFlow, { Background, Controls, MiniMap, type Node } from "reactflow";

export type NodesProps = { projectId: string };

export default function Nodes({ projectId }: NodesProps) {
  const nodes: Node[] = [
    {
      id: "default",
      type: "default",
      position: { x: 320, y: 180 },
      data: { label: `Default node (${projectId})` },
    },
  ];

  return (
    <div className="w-full" style={{ height: "calc(100vh - 120px)", minHeight: 520 }}>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        fitView
        fitViewOptions={{ padding: 0.4 }}
        style={{ width: "100%", height: "100%" }}
        className="bg-background text-foreground"
      >
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}
