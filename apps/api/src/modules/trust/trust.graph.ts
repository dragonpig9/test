/**
 * Pure graph algorithms for the trust network.
 *
 * Vouches are stored as DIRECTED edges voucher -> vouchee. For community discovery we use an
 * UNDIRECTED view of ACTIVE edges: two members are adjacent if either vouched for the other.
 * Walking an edge backwards does NOT mean the invitee endorsed the inviter — it only means the
 * two people know each other through an accepted vouch. If both directions exist, the stronger
 * effective edge represents the pair (ties: lower edge id).
 *
 * Shortest path: BFS by hop count. Among equal-length shortest paths we pick, deterministically,
 *   1) the highest connection strength (product of effective edge strengths), then
 *   2) the lexicographically smallest sequence of member handles.
 *
 * Connection strength is a descriptive number about the chain of vouches. It is NOT a
 * probability that the other person is reliable.
 */

export interface GEdge {
  id: string;
  a: string; // voucher
  b: string; // vouchee
  w: number; // effective strength (>0 only for active edges)
}

export interface Graph {
  handles: Map<string, string>;
  adj: Map<string, { to: string; edge: GEdge }[]>;
}

export function buildGraph(members: { id: string; handle: string }[], activeEdges: GEdge[]): Graph {
  const handles = new Map(members.map((m) => [m.id, m.handle]));
  const best = new Map<string, GEdge>();
  for (const e of activeEdges) {
    if (e.w <= 0 || !handles.has(e.a) || !handles.has(e.b) || e.a === e.b) continue;
    const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    const cur = best.get(key);
    if (!cur || e.w > cur.w || (e.w === cur.w && e.id < cur.id)) best.set(key, e);
  }
  const adj = new Map<string, { to: string; edge: GEdge }[]>();
  for (const m of members) adj.set(m.id, []);
  for (const e of best.values()) {
    adj.get(e.a)!.push({ to: e.b, edge: e });
    adj.get(e.b)!.push({ to: e.a, edge: e });
  }
  // Deterministic neighbour order.
  for (const list of adj.values()) list.sort((x, y) => cmp(handles.get(x.to)!, handles.get(y.to)!));
  return { handles, adj };
}

export interface BestPath {
  hops: number;
  strength: number;
  nodes: string[];
  edges: GEdge[];
  handleKey: string[];
}

const EPS = 1e-9;

/** Single-source shortest paths with deterministic tie-breaking (see header). */
export function shortestPathsFrom(g: Graph, source: string): Map<string, BestPath> {
  const best = new Map<string, BestPath>();
  if (!g.adj.has(source)) return best;
  best.set(source, { hops: 0, strength: 1, nodes: [source], edges: [], handleKey: [g.handles.get(source)!] });
  let frontier = [source];
  while (frontier.length) {
    const next = new Set<string>();
    const hop = best.get(frontier[0])!.hops + 1;
    for (const u of frontier) {
      const bu = best.get(u)!;
      for (const { to, edge } of g.adj.get(u)!) {
        const existing = best.get(to);
        if (existing && existing.hops < hop) continue; // already reached by a shorter path
        const cand: BestPath = {
          hops: hop,
          strength: bu.strength * edge.w,
          nodes: [...bu.nodes, to],
          edges: [...bu.edges, edge],
          handleKey: [...bu.handleKey, g.handles.get(to)!],
        };
        if (!existing || better(cand, existing)) best.set(to, cand);
        next.add(to);
      }
    }
    frontier = [...next].sort((x, y) => cmp(g.handles.get(x)!, g.handles.get(y)!));
  }
  return best;
}

function better(a: BestPath, b: BestPath): boolean {
  if (a.strength > b.strength + EPS) return true;
  if (a.strength < b.strength - EPS) return false;
  return cmpArr(a.handleKey, b.handleKey) < 0;
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpArr(a: string[], b: string[]) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = cmp(a[i], b[i]);
    if (c) return c;
  }
  return a.length - b.length;
}

export function hopDistances(g: Graph, source: string): Map<string, number> {
  const d = new Map<string, number>([[source, 0]]);
  const q = [source];
  while (q.length) {
    const u = q.shift()!;
    for (const { to } of g.adj.get(u) ?? []) {
      if (!d.has(to)) {
        d.set(to, d.get(u)! + 1);
        q.push(to);
      }
    }
  }
  return d;
}

export function components(g: Graph): Map<string, number> {
  const comp = new Map<string, number>();
  const sizes: number[] = [];
  for (const id of g.adj.keys()) {
    if (comp.has(id)) continue;
    const reach = hopDistances(g, id);
    for (const r of reach.keys()) comp.set(r, sizes.length);
    sizes.push(reach.size);
  }
  return new Map([...comp.entries()].map(([id, c]) => [id, sizes[c]]));
}

/** Rounds connection strength for display (keeps 4 decimals). */
export function roundStrength(n: number) {
  return Math.round(n * 10000) / 10000;
}
