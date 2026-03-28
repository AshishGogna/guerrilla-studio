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
import { executeStoryboardRunAll } from "@/lib/storyboardRunAll";
import {
  getStoryboardLastSceneIndex,
  runStoryboardDownloadAndCopy,
} from "@/lib/storyboardDownloadCopy";
import { getScenesArrayFromProject } from "@/lib/storyboardNumericPrompt";
import NodeLabel, { type NodeLabelData } from "./NodeLabel";

export type NodesProps = { projectId: string };

const nodeTypes = {
  base: BaseNode,
  nodeText: NodeText,
  nodeStoryboard: NodeStoryboard,
  nodeLabel: NodeLabel,
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

  const onLabelChange = useCallback((nodeId: string, label: string) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId && n.type === "nodeLabel"
          ? {
              ...n,
              data: { ...((n.data as unknown as NodeLabelData) ?? {}), label, onLabelChange },
            }
          : n
      )
    );
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Record<string, unknown>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [playingNodeIds, setPlayingNodeIds] = useState<Set<string>>(() => new Set());
  const [nodePlayingIds, setNodePlayingIds] = useState<Set<string>>(() => new Set());
  const [menuState, setMenuState] = useState<{
    nodeId: string;
    x: number;
    y: number;
    nodeType: string;
  } | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(
    null
  );
  const [hydrated, setHydrated] = useState(false);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const storyboardRunLockRef = useRef(false);

  const setNodePlaying = useCallback((nodeId: string, playing: boolean) => {
    setNodePlayingIds((prev) => {
      const next = new Set(prev);
      if (playing) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  }, []);

  const playTextNodeOnce = useCallback(
    async (nodeId: string) => {
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

  const playStoryboardNodeOnce = useCallback(
    async (nodeId: string, fromChain: boolean) => {
      if (storyboardRunLockRef.current) return;
      storyboardRunLockRef.current = true;
      setNodePlaying(nodeId, true);
      try {
        if (fromChain) {
          const last = getStoryboardLastSceneIndex(projectId);
          const nonce = Date.now();
          setNodes((prev) =>
            prev.map((n) => {
              if (n.id !== nodeId || n.type !== "nodeStoryboard") return n;
              const d = (n.data ?? {}) as Record<string, unknown>;
              return {
                ...n,
                data: {
                  ...d,
                  fromScene: "0",
                  toScene: String(last),
                  chainSyncNonce: nonce,
                },
              };
            })
          );
        }
        await executeStoryboardRunAll(projectId);
        if (fromChain) {
          const scenesArr = getScenesArrayFromProject(projectId);
          if (scenesArr.length > 0) {
            const lastAfter = getStoryboardLastSceneIndex(projectId);
            setNodes((prev) =>
              prev.map((n) => {
                if (n.id !== nodeId || n.type !== "nodeStoryboard") return n;
                const d = (n.data ?? {}) as Record<string, unknown>;
                return {
                  ...n,
                  data: {
                    ...d,
                    fromScene: "0",
                    toScene: String(lastAfter),
                    chainSyncNonce: Date.now(),
                  },
                };
              })
            );
            try {
              await runStoryboardDownloadAndCopy(projectId, 0, lastAfter);
            } catch (copyErr) {
              console.error(copyErr);
              alert(copyErr instanceof Error ? copyErr.message : "Download & copy failed");
            }
            window.open("https://grok.com/imagine", "_blank", "noopener,noreferrer");
          }
        }
      } catch (err) {
        console.error(err);
        alert(err instanceof Error ? err.message : "Storyboard run failed");
      } finally {
        setNodePlaying(nodeId, false);
        storyboardRunLockRef.current = false;
      }
    },
    [projectId, setNodePlaying, setNodes]
  );

  const playNodeOnce = useCallback(
    async (nodeId: string, opts?: { fromChain?: boolean }) => {
      const fromChain = opts?.fromChain ?? false;
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      if (node.type === "nodeText") {
        await playTextNodeOnce(nodeId);
        return;
      }
      if (node.type === "nodeStoryboard") {
        await playStoryboardNodeOnce(nodeId, fromChain);
      }
      // base, nodeLabel, etc.: no-op for single play
    },
    [playStoryboardNodeOnce, playTextNodeOnce]
  );

  const playChainFrom = useCallback(
    async (startNodeId: string) => {
      const visited = new Set<string>();
      let current = startNodeId;
      while (current && !visited.has(current)) {
        visited.add(current);
        await playNodeOnce(current, { fromChain: true });

        // Follow first outgoing edge only (simple + predictable).
        const nextEdge = edgesRef.current.find((e) => e.source === current);
        if (!nextEdge) break;
        const nextId = nextEdge.target;
        const nextNode = nodesRef.current.find((n) => n.id === nextId);
        if (!nextNode) break;
        current = nextId;
      }
    },
    [playNodeOnce]
  );

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
        if (n.type === "nodeLabel") {
          const d = (n.data ?? {}) as unknown as NodeLabelData;
          const next: NodeLabelData = {
            ...d,
            onLabelChange,
            onRenameDone,
            isRenaming: renamingNodeId === n.id,
          };
          return { ...n, data: next as unknown as Record<string, unknown> };
        }
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
    onLabelChange,
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
      if ("onLabelChange" in data) delete data.onLabelChange;
      if ("chainSyncNonce" in data) delete data.chainSyncNonce;
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
      setMenuState({
        nodeId: node.id,
        x: event.clientX,
        y: event.clientY,
        nodeType: node.type ?? "",
      });
    },
    []
  );

  const scaleLabelFont = useCallback((nodeId: string, multiplyBy: number) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId || n.type !== "nodeLabel") return n;
        const d = (n.data ?? {}) as NodeLabelData;
        const fs =
          typeof d.fontSizePx === "number" && d.fontSizePx > 0 ? d.fontSizePx : 14;
        const raw = fs * multiplyBy;
        const next =
          multiplyBy > 1
            ? Math.min(256, Math.round(raw * 100) / 100)
            : Math.max(6, Math.round(raw * 100) / 100);
        return { ...n, data: { ...d, fontSizePx: next } };
      })
    );
  }, [setNodes]);

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
            ? ({
                ...baseData,
                imageModel: "gemini-2.5-flash-image",
                aspectRatio: "16:9",
                fromScene: "0",
                toScene: String(
                  Math.max(0, getScenesArrayFromProject(projectId).length - 1)
                ),
              } satisfies NodeStoryboardData)
            : type === "nodeLabel"
              ? ({
                  label: "Label",
                  width: 168,
                  height: 48,
                  fontSizePx: 14,
                  onLabelChange,
                } satisfies NodeLabelData)
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
    [canvasMenu, onLabelChange, onTextChange, onTitleChange, projectId, setNodes]
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
          void playNodeOnce(id);
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
          extraItems={
            menuState.nodeType === "nodeLabel"
              ? [
                  {
                    label: "Scale up 2×",
                    onClick: () => scaleLabelFont(menuState.nodeId, 2),
                  },
                  {
                    label: "Scale down 2×",
                    onClick: () => scaleLabelFont(menuState.nodeId, 0.5),
                  },
                ]
              : undefined
          }
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
            { id: "nodeLabel", label: "Label" },
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
