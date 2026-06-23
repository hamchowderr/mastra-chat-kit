'use client';

import {
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { Canvas } from '@/components/ai-elements/canvas';
import { Connection } from '@/components/ai-elements/connection';
import { Controls } from '@/components/ai-elements/controls';
import { Edge } from '@/components/ai-elements/edge';
import {
  Node,
  NodeAction,
  NodeContent,
  NodeDescription,
  NodeFooter,
  NodeHeader,
  NodeTitle,
} from '@/components/ai-elements/node';
import { Panel } from '@/components/ai-elements/panel';
import { Toolbar } from '@/components/ai-elements/toolbar';

// Exercises the full Workflow set together: Canvas + Node + Edge (animated) +
// Connection (drag line) + Controls + Panel + Toolbar (on the selected node).
const initialNodes = [
  {
    id: '1',
    type: 'aiNode',
    position: { x: 0, y: 40 },
    data: { label: 'Input', desc: 'User prompt' },
  },
  {
    id: '2',
    type: 'aiNode',
    position: { x: 240, y: 40 },
    data: { label: 'Agent', desc: 'Reason + tools' },
  },
  {
    id: '3',
    type: 'aiNode',
    position: { x: 480, y: 40 },
    data: { label: 'Output', desc: 'Response' },
  },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2', type: 'animated' },
  { id: 'e2-3', source: '2', target: '3', type: 'animated' },
];

function AiNode({ id, data }: NodeProps) {
  const d = data as { label: string; desc: string };
  return (
    <Node handles={{ target: true, source: true }} className="w-44">
      <NodeHeader>
        <NodeTitle>{d.label}</NodeTitle>
        <NodeDescription>{d.desc}</NodeDescription>
      </NodeHeader>
      <NodeContent>
        <p className="text-muted-foreground text-xs">node #{id}</p>
      </NodeContent>
      <NodeFooter>
        <NodeAction className="text-xs">Configure</NodeAction>
      </NodeFooter>
      <Toolbar nodeId={id}>
        <button className="rounded bg-background px-2 py-1 text-xs" type="button">
          Edit
        </button>
      </Toolbar>
    </Node>
  );
}

const nodeTypes = { aiNode: AiNode };
const edgeTypes = { animated: Edge.Animated, temporary: Edge.Temporary };

export function ShowcaseCanvas() {
  const [nodes, , onNodesChange] = useNodesState<FlowNode>(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState<FlowEdge>(initialEdges);

  return (
    <div className="h-72 w-full overflow-hidden rounded-md border border-border">
      <Canvas
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineComponent={Connection}
        fitView
      >
        <Controls />
        <Panel position="top-left">
          <span className="text-xs">Workflow canvas — drag to connect</span>
        </Panel>
      </Canvas>
    </div>
  );
}
