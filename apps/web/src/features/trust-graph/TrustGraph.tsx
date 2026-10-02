import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { useMemo } from 'react';
import type { GraphView, PathResult } from '@commonhours/shared';
import { avatarColor } from '../../components/MemberChip';
import { layeredLayout } from './layout';

type MemberNodeData = { label: string; handle: string; selected: 'from' | 'to' | null; onPath: boolean; left: boolean; disconnected: boolean; bootstrap: boolean };

function MemberNode({ data }: NodeProps<Node<MemberNodeData>>) {
  return (
    <div
      className={clsx(
        'flex min-w-[150px] items-center gap-2 rounded-xl border bg-white px-3 py-2 shadow-sm',
        data.onPath ? 'border-teal-500 ring-2 ring-teal-400' : 'border-slate-200',
        data.selected && 'ring-4 ring-brand-500',
        data.left && 'opacity-50',
        data.disconnected && !data.left && 'border-dashed border-amber-400',
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-transparent" />
      <span className={clsx('inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white', avatarColor(data.handle))} aria-hidden>
        {data.label
          .split(' ')
          .map((p) => p[0])
          .join('')
          .slice(0, 2)}
      </span>
      <span className="text-left leading-tight">
        <span className="block text-sm font-semibold text-slate-900">{data.label}</span>
        <span className="block text-[11px] text-slate-500">
          @{data.handle}
          {data.bootstrap ? ' · bootstrap' : ''}
          {data.left ? ' · left' : data.disconnected ? ' · disconnected' : ''}
          {data.selected ? ` · ${data.selected}` : ''}
        </span>
      </span>
      <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-transparent" />
    </div>
  );
}

const nodeTypes = { member: MemberNode };

export function TrustGraph({
  graph,
  path,
  from,
  to,
  focusEdge,
  onNode,
  onEdge,
}: {
  graph: GraphView;
  path: PathResult | undefined;
  from?: string;
  to?: string;
  focusEdge?: string;
  onNode: (id: string) => void;
  onEdge: (id: string) => void;
}) {
  const pos = useMemo(() => layeredLayout(graph), [graph]);
  const pathEdges = new Set(path?.found ? path.steps.map((s) => s.edge.id) : []);
  const pathNodes = new Set(path?.found ? path.members.map((m) => m.id) : []);
  const nodes: Node<MemberNodeData>[] = graph.nodes.map((n) => ({
    id: n.id,
    type: 'member',
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    ariaLabel: `${n.displayName}${n.connected ? '' : ', not connected to the main network'}. Press Enter to select.`,
    data: {
      label: n.displayName,
      handle: n.handle,
      selected: n.id === from ? 'from' : n.id === to ? 'to' : null,
      onPath: pathNodes.has(n.id),
      left: n.status === 'LEFT',
      disconnected: !n.connected,
      bootstrap: n.isBootstrap,
    },
  }));
  const edges: Edge[] = graph.edges.map((e) => {
    const active = e.status === 'ACTIVE';
    const onPath = pathEdges.has(e.id);
    const color = onPath ? '#0d9488' : !active ? '#94a3b8' : e.decayed ? '#d97706' : '#059669';
    return {
      id: e.id,
      source: e.voucherId,
      target: e.voucheeId,
      animated: onPath,
      label: active ? (e.decayed ? `${e.strength}→${e.effectiveStrength}` : `${e.strength}`) : e.status.toLowerCase(),
      labelStyle: { fontSize: 11, fontWeight: 600, fill: color },
      labelBgStyle: { fill: '#fff' },
      ariaLabel: `Vouch, ${e.status.toLowerCase()}, strength ${e.effectiveStrength}`,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: {
        stroke: color,
        strokeWidth: onPath ? 4 : focusEdge === e.id ? 3.5 : active ? 2 : 1.5,
        strokeDasharray: !active ? '3 5' : e.decayed ? '7 4' : undefined,
      },
    };
  });
  return (
    <div className="h-[520px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50" aria-label="Trust network graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, n) => onNode(n.id)}
        onEdgeClick={(_, e) => onEdge(e.id)}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          const id = t.closest('.react-flow__node')?.getAttribute('data-id');
          if ((e.key === 'Enter' || e.key === ' ') && id) {
            e.preventDefault();
            onNode(id);
          }
        }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        <Background gap={20} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
