import { POLICY } from '../../config/policy';
import { seededShuffle } from '../../core/rng';

/**
 * Jury (attestor) selection, pure and unit tested.
 *
 * Step 1 — filter. A candidate must:
 *  1. not be either party;
 *  2. be an ACTIVE member who is available (not opted out of jury duty, fewer than
 *     POLICY.attestation.maxOpenAssignments open assignments);
 *  3. be at least 2 active vouch hops from BOTH parties (unreachable counts as far enough);
 *  4. never have been a direct voucher or invitee of either party (any vouch status, any invitation);
 *  5. have no declared conflict with either party (in either direction);
 *  6. meet the attestor credibility threshold;
 *  7. not already have been selected for this dispute.
 *
 * Step 2 — rank. closeness = max(relationshipTrust(candidate, A), relationshipTrust(candidate, B)),
 * using the same strongest-path relationship trust as everywhere else. The MAX keeps out someone
 * distant from one party but close to the other. Lowest closeness first; equal closeness (rounded
 * to POLICY.attestation.closenessDecimals) is ordered by a seeded shuffle (fixed seed in demo mode).
 * Credibility is only a threshold — a lower score is never preferred.
 *
 * Graph distance and closeness do not prove independence (people know each other offline), which
 * is why declared conflicts and recusal exist.
 */
export interface Candidate {
  id: string;
  handle: string;
  displayName: string;
  status: 'ACTIVE' | 'LEFT';
  score: number;
  juryAvailable?: boolean;
  openAssignments?: number;
}

export interface EligibilityContext {
  parties: { id: string; name: string }[];
  distances: Map<string, Map<string, number>>; // partyId -> (memberId -> hops)
  directRelations: Map<string, string[]>; // memberId -> party names they have a direct vouch/invite relation with
  conflicts: Map<string, string[]>; // memberId -> party names with declared conflict
  alreadySelected: Set<string>;
  /** partyId -> (memberId -> relationship trust 0..1). Optional for older callers (closeness = 0). */
  relTrust?: Map<string, Map<string, number>>;
}

export interface Closeness {
  toParties: Record<string, number>;
  value: number;
}

export interface EligibilityRow {
  memberId: string;
  eligible: boolean;
  reasons: string[];
  distances: Record<string, number | null>;
  score: number;
  closeness: Closeness | null;
  rank: number | null;
  selectionReason: string | null;
}

export const SELECTED_REASON = 'Selected because this member meets the reliability requirement and has limited connections to either party.';

export function closenessOf(memberId: string, ctx: EligibilityContext): Closeness {
  const toParties: Record<string, number> = {};
  for (const p of ctx.parties) toParties[p.id] = ctx.relTrust?.get(p.id)?.get(memberId) ?? 0;
  return { toParties, value: Math.max(0, ...Object.values(toParties)) };
}

export function evaluateEligibility(c: Candidate, ctx: EligibilityContext): EligibilityRow {
  const reasons: string[] = [];
  const distances: Record<string, number | null> = {};
  const isParty = ctx.parties.some((p) => p.id === c.id);
  if (isParty) reasons.push('Is a party to this dispute');
  if (c.status !== 'ACTIVE') reasons.push('Has left the community');
  if (c.juryAvailable === false) reasons.push('Marked unavailable for jury duty');
  if ((c.openAssignments ?? 0) >= POLICY.attestation.maxOpenAssignments) {
    reasons.push(`Not available: already has ${c.openAssignments} open jury assignment(s) (limit ${POLICY.attestation.maxOpenAssignments})`);
  }
  for (const p of ctx.parties) {
    const d = ctx.distances.get(p.id)?.get(c.id);
    distances[p.id] = d ?? null;
    if (!isParty && d !== undefined && d < POLICY.attestation.minHops) {
      reasons.push(`Only ${d} active hop(s) from ${p.name} (needs ≥ ${POLICY.attestation.minHops})`);
    }
  }
  for (const name of ctx.directRelations.get(c.id) ?? []) reasons.push(`Direct voucher or invitee of ${name} (past or present)`);
  for (const name of ctx.conflicts.get(c.id) ?? []) reasons.push(`Declared conflict of interest with ${name}`);
  if (c.score < POLICY.credibility.thresholds.attest) reasons.push(`Credibility ${c.score} below attestor threshold ${POLICY.credibility.thresholds.attest}`);
  if (ctx.alreadySelected.has(c.id)) reasons.push('Already selected in an earlier round of this dispute');
  return {
    memberId: c.id,
    eligible: reasons.length === 0,
    reasons,
    distances,
    score: c.score,
    closeness: isParty ? null : closenessOf(c.id, ctx),
    rank: null,
    selectionReason: null,
  };
}

const bucket = (v: number) => Math.round(v * 10 ** POLICY.attestation.closenessDecimals);

/**
 * Orders eligible candidates: lowest closeness first; ties randomised reproducibly. The input is
 * sorted by handle first so the shuffle depends only on the recorded seed, then a stable sort by
 * closeness bucket keeps the shuffled order inside each bucket.
 */
export function rankCandidates<T extends Candidate>(eligible: T[], closeness: (c: T) => number, seed: string): T[] {
  const ordered = [...eligible].sort((a, b) => (a.handle < b.handle ? -1 : 1));
  return seededShuffle(ordered, seed).sort((a, b) => bucket(closeness(a)) - bucket(closeness(b)));
}

export function selectAttestors<T extends Candidate>(eligible: T[], count: number, seed: string, closeness: (c: T) => number = () => 0): T[] {
  return rankCandidates(eligible, closeness, seed).slice(0, count);
}

/** Adds rank and a human selection reason to each row (the snapshot stored with the selection). */
export function annotateSelection(rows: EligibilityRow[], ranked: Candidate[], selectedIds: Set<string>, partyNames: Record<string, string>): EligibilityRow[] {
  const rankOf = new Map(ranked.map((c, i) => [c.id, i + 1]));
  return rows.map((r) => {
    if (!r.eligible || !r.closeness) return { ...r, rank: null, selectionReason: r.eligible ? null : `Excluded: ${r.reasons.join('; ')}` };
    const rank = rankOf.get(r.memberId) ?? null;
    const detail = Object.entries(r.closeness.toParties)
      .map(([id, v]) => `${partyNames[id] ?? id} ${v}`)
      .join(', ');
    const why = `closeness ${r.closeness.value} = max(relationship trust to ${detail}); rank ${rank} of ${ranked.length} (lowest closeness first, equal values ordered by the recorded seed)`;
    return { ...r, rank, selectionReason: selectedIds.has(r.memberId) ? `${SELECTED_REASON} (${why})` : `Eligible but not selected: ${why}.` };
  });
}
