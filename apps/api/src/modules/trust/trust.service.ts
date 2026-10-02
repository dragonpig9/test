import type { Member, Vouch } from '@prisma/client';
import type { GraphView, PathResult } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import type { Db } from '../../core/db';
import { notFound } from '../../core/errors';
import { toSummary } from '../members/member.repo';
import { effectiveEdge } from '../vouches/vouch.rules';
import { toEdgeView } from '../vouches/vouch.view';
import { buildGraph, components, hopDistances, roundStrength, shortestPathsFrom, type Graph } from './trust.graph';

export const UNDIRECTED_NOTE =
  'Paths use an undirected view of active vouches: walking an edge backwards (vouchee → voucher) shows the two people are connected, not that the vouchee endorsed the voucher.';

export const TIE_BREAK_NOTE =
  'Shortest path by hops (BFS). Equal-length ties: highest connection strength first, then alphabetical order of member handles.';

export interface TrustSnapshot {
  members: Member[];
  vouches: Vouch[];
  graph: Graph;
  now: Date;
}

/**
 * Loads members and vouches and builds the active graph at `now`.
 * Members who have LEFT keep their history but are excluded from reachability.
 */
export async function loadTrust(db: Db, now: Date): Promise<TrustSnapshot> {
  const [members, vouches] = await Promise.all([
    db.member.findMany({ orderBy: { handle: 'asc' } }),
    db.vouch.findMany({ orderBy: { createdAt: 'asc' } }),
  ]);
  const activeMembers = members.filter((m) => m.status === 'ACTIVE');
  const edges = vouches
    .map((v) => ({ v, e: effectiveEdge(v, now) }))
    .filter(({ e }) => e.status === 'ACTIVE')
    .map(({ v, e }) => ({ id: v.id, a: v.voucherId, b: v.voucheeId, w: e.effectiveStrength }));
  return { members, vouches, graph: buildGraph(activeMembers, edges), now };
}

export function graphView(t: TrustSnapshot): GraphView {
  const comp = components(t.graph);
  const largest = Math.max(0, ...comp.values());
  return {
    nodes: t.members.map((m) => ({
      ...toSummary(m),
      connected: m.status === 'ACTIVE' && (comp.get(m.id) ?? 0) === largest && largest > 1,
      componentSize: comp.get(m.id) ?? 0,
    })),
    edges: t.vouches.filter((v) => v.status !== 'DECLINED').map((v) => toEdgeView(v, t.now)),
    rules: {
      decayAfterMonths: POLICY.vouches.decayAfterMonths,
      decayFactor: POLICY.vouches.decayFactor,
      expireAfterMonths: POLICY.vouches.expireAfterMonths,
      undirectedNote: UNDIRECTED_NOTE,
    },
    now: t.now.toISOString(),
  };
}

export function findPath(t: TrustSnapshot, fromId: string, toId: string): PathResult {
  const byId = new Map(t.members.map((m) => [m.id, m]));
  const from = byId.get(fromId);
  const to = byId.get(toId);
  if (!from || !to) throw notFound('trust', 'Member');
  const vouchById = new Map(t.vouches.map((v) => [v.id, v]));
  if (fromId === toId) {
    return { found: true, hops: 0, strength: 1, members: [toSummary(from)], steps: [], calculation: '1 (same member)', explanation: 'Same member.', tieBreak: TIE_BREAK_NOTE };
  }
  const best = shortestPathsFrom(t.graph, fromId).get(toId);
  if (!best) {
    const why =
      from.status === 'LEFT' || to.status === 'LEFT'
        ? 'One of these members has left the community, so they are not part of the active network.'
        : 'No chain of ACTIVE vouches connects these members. Expired, revoked, pending or declined edges cannot establish reachability.';
    return { found: false, hops: null, strength: null, members: [toSummary(from), toSummary(to)], steps: [], calculation: 'n/a', explanation: why, tieBreak: TIE_BREAK_NOTE };
  }
  const steps = best.edges.map((ge, i) => {
    const a = byId.get(best.nodes[i])!;
    const b = byId.get(best.nodes[i + 1])!;
    const v = vouchById.get(ge.id)!;
    return { from: toSummary(a), to: toSummary(b), edge: toEdgeView(v, t.now), forward: v.voucherId === a.id };
  });
  const strength = roundStrength(best.strength);
  const calc = `${best.edges.map((e) => e.w).join(' × ')} = ${strength}`;
  const names = best.nodes.map((id) => byId.get(id)!.displayName).join(' → ');
  return {
    found: true,
    hops: best.hops,
    strength,
    members: best.nodes.map((id) => toSummary(byId.get(id)!)),
    steps,
    calculation: calc,
    explanation: `${names}: ${best.hops} hop(s). Connection strength is the product of the effective strengths of the vouches on this path (${calc}). It describes the chain of vouches, not the probability that anyone is reliable.`,
    tieBreak: TIE_BREAK_NOTE,
  };
}

/** Hop counts and strengths from one member to every reachable member (used for listing filters and attestor eligibility). */
export function reachFrom(t: TrustSnapshot, fromId: string) {
  const paths = shortestPathsFrom(t.graph, fromId);
  return new Map([...paths.entries()].map(([id, p]) => [id, { hops: p.hops, strength: roundStrength(p.strength) }]));
}

export function hopsFrom(t: TrustSnapshot, fromId: string) {
  return hopDistances(t.graph, fromId);
}
