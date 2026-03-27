"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import BaseNode, { type BaseNodeData } from "./BaseNode";

export type NodeTextData = BaseNodeData & {
  text: string;
};

export default function NodeText(props: NodeProps<NodeTextData>) {
  return (
    <BaseNode {...props} className="border-accent/50">
      <div className="text-sm text-foreground/90">{props.data.text}</div>
      <Handle type="source" position={Position.Right} />
    </BaseNode>
  );
}

