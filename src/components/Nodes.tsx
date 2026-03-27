"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  useReactFlow,
  useEdgesState,
  useNodesState,
} from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import CanvasMenu, { type CanvasNodeTypeId } from "./CanvasMenu";
import NodeMenu from "./NodeMenu";
import NodeText, { type NodeTextData } from "./NodeText";

export type NodesProps = { projectId: string };

const nodeTypes = {
  base: BaseNode,
  nodeText: NodeText,
};

function NodesInner({ projectId }: NodesProps) {
  const rf = useReactFlow();
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

  const onTextChange = useCallback((nodeId: string, text: string) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: { ...(n.data as NodeTextData), text, onTextChange },
            }
          : n
      )
    );
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
        data: { title: "NodeText", text: "NodeText value", onTitleChange, onTextChange },
      },
    ],
    [onTextChange, onTitleChange, projectId]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menuState, setMenuState] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(
    null
  );

  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const d = n.data as BaseNodeData;
        const next = {
          ...d,
          onTitleChange,
          onRenameDone,
          isRenaming: renamingNodeId === n.id,
          ...(n.type === "nodeText" ? { onTextChange } : {}),
        };
        return { ...n, data: next as typeof next };
      })
    );
  }, [onRenameDone, onTextChange, onTitleChange, renamingNodeId, setNodes]);

  const handleNodeContextMenu = useCallback<NodeMouseHandler>(
    (event, node) => {
      event.preventDefault();
      setCanvasMenu(null);
      setMenuState({ nodeId: node.id, x: event.clientX, y: event.clientY });
    },
    []
  );

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setMenuState(null);
      const pos = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setCanvasMenu({ x: event.clientX, y: event.clientY, flowX: pos.x, flowY: pos.y });
    },
    [rf]
  );

  const addNodeOfType = useCallback(
    (type: CanvasNodeTypeId) => {
      if (!canvasMenu) return;
      const id = `${type}-${Date.now()}`;
      const position = { x: canvasMenu.flowX, y: canvasMenu.flowY };
      const baseData: BaseNodeData = { title: type === "base" ? "Base Node" : "NodeText", onTitleChange };
      const data =
        type === "nodeText"
          ? ({ ...baseData, text: "", onTextChange } satisfies NodeTextData)
          : baseData;
      setNodes((prev) => [
        ...prev,
        {
          id,
          type,
          position,
          data,
        } as Node,
      ]);
      setCanvasMenu(null);
    },
    [canvasMenu, onTextChange, onTitleChange, setNodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges]
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    },
    [setEdges]
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
        edges={edges}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
        deleteKeyCode={["Backspace", "Delete"]}
        nodeTypes={nodeTypes}
        onPaneClick={() => setMenuState(null)}
        onPaneContextMenu={handlePaneContextMenu}
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
      {canvasMenu ? (
        <CanvasMenu
          x={canvasMenu.x}
          y={canvasMenu.y}
          nodeTypes={[
            { id: "base", label: "Base" },
            { id: "nodeText", label: "Text" },
          ]}
          onAddNodeType={addNodeOfType}
          onClose={() => setCanvasMenu(null)}
        />
      ) : null}
    </div>
  );
}

export default function Nodes(props: NodesProps) {
  return (
    <ReactFlowProvider>
      <NodesInner {...props} />
    </ReactFlowProvider>
  );
}
