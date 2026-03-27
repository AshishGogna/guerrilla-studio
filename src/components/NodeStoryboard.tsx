"use client";

import { useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";
import { useNodesContext } from "./NodesContext";
import { getData } from "@/lib/data";

const IMAGE_MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"] as const;
type ImageModel = (typeof IMAGE_MODELS)[number];

export type NodeStoryboardData = BaseNodeData & {
  imageModel?: ImageModel;
};

export default function NodeStoryboard(props: NodeProps<NodeStoryboardData>) {
  const { projectId, runStoryboardAll } = useNodesContext();
  const [imageModel, setImageModel] = useState<ImageModel>(
    props.data.imageModel ?? IMAGE_MODELS[0]
  );

  const scenesCount = useMemo(() => {
    const raw = getData(projectId, "scenes");
    if (Array.isArray(raw)) return raw.length;
    try {
      const parsed = JSON.parse(String(raw ?? "null")) as unknown;
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }, [projectId]);

  return (
    <BaseNode
      {...props}
      className="min-w-[360px] border-foreground/20"
      onPlayClick={() => {
        runStoryboardAll();
      }}
    >
      <div className="text-sm text-foreground/80">{`{${scenesCount} Scenes}`}</div>

      <div className="mt-3">
        <label className="mb-1 block text-xs text-foreground/60">Image model</label>
        <select
          value={imageModel}
          onChange={(e) => setImageModel(e.target.value as ImageModel)}
          className="nodrag w-full rounded border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="nodrag flex-1 rounded border border-foreground/20 bg-foreground/10 px-2 py-1.5 text-sm hover:bg-foreground/20"
          onClick={() => {}}
        >
          Populate
        </button>
        <button
          type="button"
          className="nodrag flex-1 rounded bg-accent px-2 py-1.5 text-sm text-background hover:opacity-90"
          onClick={() => {}}
        >
          Generate
        </button>
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </BaseNode>
  );
}

