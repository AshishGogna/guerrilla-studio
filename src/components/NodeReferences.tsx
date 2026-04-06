"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import { useNodesContext } from "./NodesContext";
import { getData, REFERENCES_DATA_CHANGED_EVENT } from "@/lib/data";
import {
  NODE_IMAGE_MODELS,
  type NodeImageModel,
} from "@/lib/nodeImageModels";

const ASPECT_RATIOS = ["1:1", "9:16", "16:9"] as const;
type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type NodeReferencesData = BaseNodeData & {
  aspectRatio?: string;
  imageModel?: NodeImageModel;
};

function getReferencesCount(projectId: string): number {
  let raw: unknown = getData(projectId, "references");
  if (!Array.isArray(raw)) {
    try {
      raw = JSON.parse(String(raw ?? "null")) as unknown;
    } catch {
      return 0;
    }
  }
  return Array.isArray(raw) ? raw.length : 0;
}

export default function NodeReferences(props: NodeProps<NodeReferencesData>) {
  const { id, data } = props;
  const { projectId, selectNode } = useNodesContext();
  const rf = useReactFlow();

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(() => {
    if (data.aspectRatio && ASPECT_RATIOS.includes(data.aspectRatio as AspectRatio)) {
      return data.aspectRatio as AspectRatio;
    }
    return "1:1";
  });
  const [imageModel, setImageModel] = useState<NodeImageModel>(() => {
    if (data.imageModel && NODE_IMAGE_MODELS.includes(data.imageModel)) {
      return data.imageModel;
    }
    return NODE_IMAGE_MODELS[0];
  });
  const [refsTick, setRefsTick] = useState(0);

  useEffect(() => {
    const onRefs = (e: Event) => {
      const d = (e as CustomEvent<{ projectId?: string }>).detail;
      if (d?.projectId === projectId) setRefsTick((t) => t + 1);
    };
    window.addEventListener(REFERENCES_DATA_CHANGED_EVENT, onRefs);
    return () => window.removeEventListener(REFERENCES_DATA_CHANGED_EVENT, onRefs);
  }, [projectId]);

  const totalReferences = useMemo(
    () => getReferencesCount(projectId),
    [projectId, refsTick]
  );

  useEffect(() => {
    if (data.aspectRatio && ASPECT_RATIOS.includes(data.aspectRatio as AspectRatio)) {
      setAspectRatio(data.aspectRatio as AspectRatio);
    }
    if (data.imageModel && NODE_IMAGE_MODELS.includes(data.imageModel)) {
      setImageModel(data.imageModel);
    }
  }, [data.aspectRatio, data.imageModel, id]);

  const patchNodeData = useCallback(
    (patch: Partial<NodeReferencesData>) => {
      rf.setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...(n.data as object), ...patch } } : n
        )
      );
    },
    [id, rf]
  );

  return (
    <BaseNode {...props} className="min-w-[320px]">
      <div className="text-sm text-foreground/80">
        Total references: {totalReferences}
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs text-foreground/60">Aspect ratio</label>
        <select
          value={aspectRatio}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(id, e);
          }}
          onChange={(e) => {
            const v = e.target.value as AspectRatio;
            setAspectRatio(v);
            patchNodeData({ aspectRatio: v });
          }}
          className="nodrag w-full rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
        >
          {ASPECT_RATIOS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs text-foreground/60">Image model</label>
        <select
          value={imageModel}
          onMouseDown={(e) => {
            e.stopPropagation();
            selectNode(id, e);
          }}
          onChange={(e) => {
            const v = e.target.value as NodeImageModel;
            setImageModel(v);
            patchNodeData({ imageModel: v });
          }}
          className="nodrag w-full rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
        >
          {NODE_IMAGE_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </BaseNode>
  );
}
