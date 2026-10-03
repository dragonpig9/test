/**
 * Pure graph algorithms for the trust network.
 *
 * Two questions, two algorithms:
 *  - NAVIGATION / attestor distance: fewest hops over active vouches (BFS, `shortestPathsFrom`,
 *    `hopDistances`). Unchanged from v1.
 *  - RELATIONSHIP TRUST (strength): the STRONGEST valid path = maximum product of active edge
 *    strengths (`strongestPathsFrom`, Dijkstra on −log(strength)). Ties: fewer hops, then the
 *    alphabetical sequence of handles (stable across resets). Because the maximum is taken over
 *    all paths, adding a new (even weak) edge can never lower anyone's relationship trust —
 *    BFS could, by swapping a strong 3-hop path for a weak direct edge.
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
  /** Σ −log(edge strength); lower = stronger. Only set by strongestPathsFrom. */
  cost?: number;
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

/**
 * Strongest path from `source` to every reachable member (Dijkstra with cost −log w, w ∈ (0, 1]).
 * The order (cost, hops, handle sequence) is preserved when the same edge is appended to two
 * paths, so the greedy choice is valid and the result is deterministic.
 */
export function strongestPathsFrom(g: Graph, source: string): Map<string, BestPath> {
  const best = new Map<string, BestPath>();
  if (!g.adj.has(source)) return best;
  best.set(source, { hops: 0, strength: 1, cost: 0, nodes: [source], edges: [], handleKey: [g.handles.get(source)!] });
  const done = new Set<string>();
  for (;;) {
    let u: string | undefined;
    let bu: BestPath | undefined;
    for (const [id, p] of best) if (!done.has(id) && (!bu || stronger(p, bu))) [u, bu] = [id, p];
    if (!u || !bu) break;
    done.add(u);
    for (const { to, edge } of g.adj.get(u)!) {
      if (done.has(to) || edge.w <= 0) continue;
      const w = Math.min(edge.w, 1);
      const cand: BestPath = {
        hops: bu.hops + 1,
        strength: bu.strength * w,
        cost: bu.cost! - Math.log(w),
        nodes: [...bu.nodes, to],
        edges: [...bu.edges, edge],
        handleKey: [...bu.handleKey, g.handles.get(to)!],
      };
      const existing = best.get(to);
      if (!existing || stronger(cand, existing)) best.set(to, cand);
    }
  }
  return best;
}

function stronger(a: BestPath, b: BestPath): boolean {
  if (a.cost! < b.cost! - EPS) return true;
  if (a.cost! > b.cost! + EPS) return false;
  if (a.hops !== b.hops) return a.hops < b.hops;
  return cmpArr(a.handleKey, b.handleKey) < 0;
}

/**
 * Combines the vouch and the earned relationship between the same two members into one pair
 * strength: 1 − (1 − vouch)(1 − earned). Bounded by 1, never below either input, and equal to
 * the vouch strength when nothing was earned (so vouch-only paths keep their v1 values).
 */
export function combinePair(vouch: number, earned: number): number {
  return 1 - (1 - Math.max(0, vouch)) * (1 - Math.max(0, earned));
}

export interface PairParts {
  vouch: GEdge | null;
  earned: GEdge | null;
}

/** Relationship graph: one combined edge per pair (id "pair:<a>|<b>") built from both edge kinds. */
export function buildRelationshipGraph(members: { id: string; handle: string }[], vouchEdges: GEdge[], earnedEdges: GEdge[]) {
  const ids = new Set(members.map((m) => m.id));
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const parts = new Map<string, PairParts>();
  const consider = (e: GEdge, kind: 'vouch' | 'earned') => {
    if (e.w <= 0 || e.a === e.b || !ids.has(e.a) || !ids.has(e.b)) return;
    const k = key(e.a, e.b);
    const p = parts.get(k) ?? { vouch: null, earned: null };
    const cur = p[kind];
    if (!cur || e.w > cur.w || (e.w === cur.w && e.id < cur.id)) p[kind] = e;
    parts.set(k, p);
  };
  for (const e of vouchEdges) consider(e, 'vouch');
  for (const e of earnedEdges) consider(e, 'earned');
  const combined: GEdge[] = [...parts.entries()].map(([k, p]) => {
    const [a, b] = k.split('|');
    return { id: `pair:${k}`, a, b, w: combinePair(p.vouch?.w ?? 0, p.earned?.w ?? 0) };
  });
  return { graph: buildGraph(members, combined), parts };
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
