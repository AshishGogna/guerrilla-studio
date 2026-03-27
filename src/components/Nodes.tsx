"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  useNodesState,
} from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import NodeMenu from "./NodeMenu";
import NodeText, { type NodeTextData } from "./NodeText";

export type NodesProps = { projectId: string };

const nodeTypes = {
  base: BaseNode,
  nodeText: NodeText,
};

export default function Nodes({ projectId }: NodesProps) {
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);

  const onTitleChange = useCallback((nodeId: string, title: string) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: { ...(n.data as BaseNodeData), title, onTitleChange },
            }
          : n
      )
    );
  }, []);

  const onRenameDone = useCallback(() => {
    setRenamingNodeId(null);
  }, []);

  const initialNodes = useMemo<Node[]>(
    () => [
      {
        id: "base",
        type: "base",
        position: { x: 320, y: 180 },
        data: { title: `Base Node (${projectId})`, onTitleChange },
      },
      {
        id: "text-1",
        type: "nodeText",
        position: { x: 620, y: 180 },
        data: { title: "NodeText", text: "NodeText value", onTitleChange },
      },
    ],
    [onTitleChange, projectId]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [menuState, setMenuState] = useState<{ nodeId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const d = n.data as BaseNodeData;
        const next = {
          ...d,
          onTitleChange,
          onRenameDone,
          isRenaming: renamingNodeId === n.id,
        };
        return { ...n, data: next as typeof next };
      })
    );
  }, [onRenameDone, onTitleChange, renamingNodeId, setNodes]);

  const handleNodeContextMenu = useCallback<NodeMouseHandler>(
    (event, node) => {
      event.preventDefault();
      setMenuState({ nodeId: node.id, x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleRenameNode = useCallback(() => {
    if (!menuState) return;
    setRenamingNodeId(menuState.nodeId);
    setMenuState(null);
  }, [menuState]);

  const handleDeleteNode = useCallback(() => {
    if (!menuState) return;
    setNodes((prev) => prev.filter((n) => n.id !== menuState.nodeId));
    setMenuState(null);
  }, [menuState, setNodes]);

  return (
    <div className="w-full" style={{ height: "calc(100vh - 120px)", minHeight: 520 }}>
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={[]}
        nodeTypes={nodeTypes}
        onPaneClick={() => setMenuState(null)}
        onNodeContextMenu={handleNodeContextMenu}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.4 }}
        style={{ width: "100%", height: "100%" }}
        className="bg-background text-foreground"
      >
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
      {menuState ? (
        <NodeMenu
          x={menuState.x}
          y={menuState.y}
          onRename={handleRenameNode}
          onDelete={handleDeleteNode}
          onClose={() => setMenuState(null)}
        />
      ) : null}
    </div>
  );
}
