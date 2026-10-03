import type { EarnedRelationship, Member, Vouch } from '@prisma/client';
import type { GraphView, PathResult, PathStep } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import type { Db } from '../../core/db';
import { notFound } from '../../core/errors';
import { toSummary } from '../members/member.repo';
import { effectiveEdge } from '../vouches/vouch.rules';
import { toEdgeView } from '../vouches/vouch.view';
import { effectiveEarned } from './trust.earned.rules';
import { toEarnedEdgeView } from './trust.view';
import { buildGraph, buildRelationshipGraph, components, hopDistances, roundStrength, strongestPathsFrom, type BestPath, type Graph, type PairParts } from './trust.graph';

export const UNDIRECTED_NOTE =
  'Paths use an undirected view of active vouches and earned relationships: walking a vouch backwards (vouchee → voucher) shows the two people are connected, not that the vouchee endorsed the voucher. Earned relationships come from exchanges both members confirmed and carry no voucher liability.';

export const TIE_BREAK_NOTE =
  'Relationship trust uses the STRONGEST path: the maximum product of active edge strengths (Dijkstra on −log strength). Equal strength: fewer hops first, then alphabetical order of member handles. A pair linked by both a vouch and an earned relationship counts as 1 − (1 − vouch)(1 − earned).';

export interface TrustSnapshot {
  members: Member[];
  vouches: Vouch[];
  earned: EarnedRelationship[];
  /** Active vouches only — fewest-hop navigation and the attestor distance rule. */
  graph: Graph;
  /** Vouches + earned relationships combined per pair — relationship trust (strongest path). */
  relGraph: Graph;
  pairs: Map<string, PairParts>;
  now: Date;
}

/**
 * Loads members, vouches and earned relationships and builds both graphs at `now`.
 * Members who have LEFT keep their history but are excluded from reachability.
 */
export async function loadTrust(db: Db, now: Date): Promise<TrustSnapshot> {
  const [members, vouches, earned] = await Promise.all([
    db.member.findMany({ orderBy: { handle: 'asc' } }),
    db.vouch.findMany({ orderBy: { createdAt: 'asc' } }),
    db.earnedRelationship.findMany({ where: { strength: { gt: 0 } }, orderBy: { createdAt: 'asc' } }),
  ]);
  const activeMembers = members.filter((m) => m.status === 'ACTIVE');
  const vouchEdges = vouches
    .map((v) => ({ v, e: effectiveEdge(v, now) }))
    .filter(({ e }) => e.status === 'ACTIVE')
    .map(({ v, e }) => ({ id: v.id, a: v.voucherId, b: v.voucheeId, w: e.effectiveStrength }));
  const earnedEdges = earned
    .map((r) => ({ r, e: effectiveEarned(r, now) }))
    .filter(({ e }) => e.status === 'ACTIVE')
    .map(({ r, e }) => ({ id: r.id, a: r.memberAId, b: r.memberBId, w: e.effectiveStrength }));
  const rel = buildRelationshipGraph(activeMembers, vouchEdges, earnedEdges);
  return { members, vouches, earned, graph: buildGraph(activeMembers, vouchEdges), relGraph: rel.graph, pairs: rel.parts, now };
}

export function graphView(t: TrustSnapshot): GraphView {
  const comp = components(t.relGraph);
  const largest = Math.max(0, ...comp.values());
  return {
    nodes: t.members.map((m) => ({
      ...toSummary(m),
      connected: m.status === 'ACTIVE' && (comp.get(m.id) ?? 0) === largest && largest > 1,
      componentSize: comp.get(m.id) ?? 0,
    })),
    edges: t.vouches.filter((v) => v.status !== 'DECLINED').map((v) => toEdgeView(v, t.now)),
    earnedEdges: t.earned.map((r) => toEarnedEdgeView(r, t.now)),
    rules: {
      decayAfterMonths: POLICY.vouches.decayAfterMonths,
      decayFactor: POLICY.vouches.decayFactor,
      expireAfterMonths: POLICY.vouches.expireAfterMonths,
      undirectedNote: UNDIRECTED_NOTE,
    },
    now: t.now.toISOString(),
  };
}

function pairOf(t: TrustSnapshot, pairEdgeId: string): PairParts {
  return t.pairs.get(pairEdgeId.replace(/^pair:/, '')) ?? { vouch: null, earned: null };
}

export function findPath(t: TrustSnapshot, fromId: string, toId: string): PathResult {
  const byId = new Map(t.members.map((m) => [m.id, m]));
  const from = byId.get(fromId);
  const to = byId.get(toId);
  if (!from || !to) throw notFound('trust', 'Member');
  const vouchById = new Map(t.vouches.map((v) => [v.id, v]));
  const earnedById = new Map(t.earned.map((r) => [r.id, r]));
  const fewestVouchHops = hopDistances(t.graph, fromId).get(toId) ?? null;
  if (fromId === toId) {
    return { found: true, hops: 0, strength: 1, members: [toSummary(from)], steps: [], calculation: '1 (same member)', explanation: 'Same member.', tieBreak: TIE_BREAK_NOTE, fewestVouchHops: 0 };
  }
  const best = strongestPathsFrom(t.relGraph, fromId).get(toId);
  if (!best) {
    const why =
      from.status === 'LEFT' || to.status === 'LEFT'
        ? 'One of these members has left the community, so they are not part of the active network.'
        : 'No chain of ACTIVE vouches or earned relationships connects these members. Expired, revoked, pending or declined edges cannot establish reachability.';
    return { found: false, hops: null, strength: null, members: [toSummary(from), toSummary(to)], steps: [], calculation: 'n/a', explanation: why, tieBreak: TIE_BREAK_NOTE, fewestVouchHops };
  }
  const steps: PathStep[] = best.edges.map((ge, i) => {
    const a = byId.get(best.nodes[i])!;
    const b = byId.get(best.nodes[i + 1])!;
    const parts = pairOf(t, ge.id);
    const v = parts.vouch ? vouchById.get(parts.vouch.id)! : null;
    const r = parts.earned ? earnedById.get(parts.earned.id)! : null;
    return {
      from: toSummary(a),
      to: toSummary(b),
      edge: v ? toEdgeView(v, t.now) : null,
      earned: r ? toEarnedEdgeView(r, t.now) : null,
      strength: roundStrength(ge.w),
      kind: v && r ? 'both' : v ? 'vouch' : 'earned',
      forward: v ? v.voucherId === a.id : true,
    };
  });
  const strength = roundStrength(best.strength);
  const calc = `${steps.map((s) => s.strength).join(' × ')} = ${strength}`;
  const names = best.nodes.map((id) => byId.get(id)!.displayName).join(' → ');
  const combinedNote = steps.some((s) => s.kind !== 'vouch')
    ? ' Steps marked “earned” come from exchanges both members confirmed; a pair with both a vouch and an earned relationship counts as 1 − (1 − vouch)(1 − earned).'
    : '';
  return {
    found: true,
    hops: best.hops,
    strength,
    members: best.nodes.map((id) => toSummary(byId.get(id)!)),
    steps,
    calculation: calc,
    explanation: `${names}: ${best.hops} hop(s). Relationship trust is the strongest chain — the product of edge strengths on this path (${calc}).${combinedNote} It describes the chain of relationships, not the probability that anyone is reliable.`,
    tieBreak: TIE_BREAK_NOTE,
    fewestVouchHops,
  };
}

function toReach(paths: Map<string, BestPath>) {
  return new Map([...paths.entries()].map(([id, p]) => [id, { hops: p.hops, strength: roundStrength(p.strength) }]));
}

/** Strongest-path hops and strength from one member to every reachable member (listing reachability). */
export function reachFrom(t: TrustSnapshot, fromId: string) {
  return toReach(strongestPathsFrom(t.relGraph, fromId));
}

/**
 * Relationship trust between two members: strength of the strongest valid path (0 when unreachable).
 * The single definition used by the path finder, task eligibility and jury closeness.
 */
export function relationshipTrust(t: TrustSnapshot, a: string, b: string): number {
  if (a === b) return 1;
  return roundStrength(strongestPathsFrom(t.relGraph, a).get(b)?.strength ?? 0);
}

/** Relationship trust from one member to everyone (0 = unreachable). */
export function relationshipTrustFrom(t: TrustSnapshot, fromId: string): Map<string, number> {
  const paths = strongestPathsFrom(t.relGraph, fromId);
  return new Map(t.members.map((m) => [m.id, roundStrength(paths.get(m.id)?.strength ?? 0)]));
}

/** Fewest active-vouch hops (navigation and the attestor distance requirement; unchanged rule). */
export function hopsFrom(t: TrustSnapshot, fromId: string) {
  return hopDistances(t.graph, fromId);
}
