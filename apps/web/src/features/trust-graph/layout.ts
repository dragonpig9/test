import type { GraphView } from '@commonhours/shared';

/**
 * Deterministic layered layout for display only: BFS depth from the bootstrap member over
 * every recorded edge (any status), so expired/revoked edges still appear in context.
 * Members never connected by any edge are placed in a separate "disconnected" row.
 */
export function layeredLayout(g: GraphView) {
  const adj = new Map<string, string[]>();
  for (const n of g.nodes) adj.set(n.id, []);
  for (const e of g.edges) {
    adj.get(e.voucherId)?.push(e.voucheeId);
    adj.get(e.voucheeId)?.push(e.voucherId);
  }
  const root = g.nodes.find((n) => n.isBootstrap) ?? g.nodes[0];
  const depth = new Map<string, number>();
  if (root) {
    depth.set(root.id, 0);
    const q = [root.id];
    while (q.length) {
      const u = q.shift()!;
      for (const v of adj.get(u) ?? []) if (!depth.has(v)) (depth.set(v, depth.get(u)! + 1), q.push(v));
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  const layers = new Map<number, string[]>();
  for (const n of [...g.nodes].sort((a, b) => a.handle.localeCompare(b.handle))) {
    const d = depth.get(n.id) ?? maxDepth + 1;
    layers.set(d, [...(layers.get(d) ?? []), n.id]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  const W = 210;
  const H = 150;
  for (const [d, ids] of layers) {
    ids.forEach((id, i) => pos.set(id, { x: (i - (ids.length - 1) / 2) * W, y: d * H }));
  }
  return pos;
}
