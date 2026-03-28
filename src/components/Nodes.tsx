"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { generateText } from "@/lib/ai";
import { NodesProvider } from "./NodesContext";
import { parseAiResponse, parsePrompt } from "@/lib/textParser";
import NodeStoryboard, { type NodeStoryboardData } from "./NodeStoryboard";

export type NodesProps = { projectId: string };

const nodeTypes = {
  base: BaseNode,
  nodeText: NodeText,
  nodeStoryboard: NodeStoryboard,
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
              data: { ...((n.data as unknown as BaseNodeData) ?? {}), title, onTitleChange },
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
              data: { ...((n.data as unknown as NodeTextData) ?? {}), text, onTextChange },
            }
          : n
      )
    );
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Record<string, unknown>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [playingNodeIds, setPlayingNodeIds] = useState<Set<string>>(() => new Set());
  const [nodePlayingIds, setNodePlayingIds] = useState<Set<string>>(() => new Set());
  const [menuState, setMenuState] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(
    null
  );
  const [hydrated, setHydrated] = useState(false);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const playTextNodeOnce = useCallback(
    async (nodeId: string) => {
      console.log('playTextNodeOnce AAAA:', nodeId);
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node || node.type !== "nodeText") return;
      const rawText = String((node.data as Record<string, unknown>)?.text ?? "");
      setPlayingNodeIds((prev) => new Set(prev).add(nodeId));
      try {
        const userPrompt = parsePrompt(projectId, rawText);
        const output = await generateText(userPrompt, "", "gpt-5.4");
        parseAiResponse(projectId, output);
      } finally {
        setPlayingNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }
    },
    [projectId]
  );

  const playChainFrom = useCallback(
    async (startNodeId: string) => {
      const visited = new Set<string>();
      let current = startNodeId;
      while (current && !visited.has(current)) {
        visited.add(current);
        await playTextNodeOnce(current);

        // Follow first outgoing edge only (simple + predictable).
        const nextEdge = edgesRef.current.find((e) => e.source === current);
        if (!nextEdge) break;
        const nextId = nextEdge.target;
        const nextNode = nodesRef.current.find((n) => n.id === nextId);
        if (!nextNode || nextNode.type !== "nodeText") break;
        current = nextId;
      }
    },
    [playTextNodeOnce]
  );

  const setNodePlaying = useCallback((nodeId: string, playing: boolean) => {
    setNodePlayingIds((prev) => {
      const next = new Set(prev);
      if (playing) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/nodes-state?projectId=${encodeURIComponent(projectId)}`);
        const data = (await res.json().catch(() => null)) as { nodes?: unknown; edges?: unknown } | null;
        if (cancelled) return;
        const loadedNodes = Array.isArray(data?.nodes) ? (data?.nodes as Node<Record<string, unknown>>[]) : [];
        const loadedEdges = Array.isArray(data?.edges) ? (data?.edges as Edge[]) : [];
        setNodes(loadedNodes);
        setEdges(loadedEdges);
      } catch {
        if (cancelled) return;
        setNodes([]);
        setEdges([]);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, setEdges, setNodes]);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const d = n.data as unknown as BaseNodeData;
        const next = {
          ...d,
          onTitleChange,
          onRenameDone,
          isPlaying: playingNodeIds.has(n.id) || nodePlayingIds.has(n.id),
          isRenaming: renamingNodeId === n.id,
          ...(n.type === "nodeText" ? { onTextChange } : {}),
        };
        return { ...n, data: next as unknown as Record<string, unknown> };
      })
    );
  }, [
    onRenameDone,
    onTextChange,
    onTitleChange,
    playChainFrom,
    playTextNodeOnce,
    playingNodeIds,
    nodePlayingIds,
    renamingNodeId,
    setNodes,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    const tidyNodes = nodes.map((n) => {
      const base = n.data as unknown as Partial<BaseNodeData> & Record<string, unknown>;
      const data: Record<string, unknown> = { ...base };
      delete data.onTitleChange;
      delete data.onRenameDone;
      delete data.isRenaming;
      delete data.isPlaying;
      if ("onTextChange" in data) delete data.onTextChange;
      return { ...n, data };
    });
    const tidyEdges = edges.map((e) => ({ ...e }));
    const payload = { nodes: tidyNodes, edges: tidyEdges };
    const timeout = setTimeout(() => {
      fetch("/api/nodes-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, state: payload }),
      }).catch(() => {
        // ignore
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [edges, hydrated, nodes, projectId]);

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
      const baseData: BaseNodeData = {
        title:
          type === "base"
            ? "Base Node"
            : type === "nodeStoryboard"
              ? "Storyboard"
              : "NodeText",
        onTitleChange,
      };
      const data =
        type === "nodeText"
          ? ({ ...baseData, text: "", onTextChange } satisfies NodeTextData)
          : type === "nodeStoryboard"
            ? ({ ...baseData, imageModel: "gemini-2.5-flash-image" } satisfies NodeStoryboardData)
            : baseData;
      setNodes((prev) => [
        ...prev,
        {
          id,
          type,
          position,
          data,
        } as Node<Record<string, unknown>>,
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
      <NodesProvider
        projectId={projectId}
        playNode={(id) => {
          void playTextNodeOnce(id);
        }}
        playChain={(id) => {
          void playChainFrom(id);
        }}
        setNodePlaying={setNodePlaying}
      >
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
      </NodesProvider>
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
            { id: "nodeStoryboard", label: "Storyboard" },
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
