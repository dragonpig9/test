import { POLICY } from '../../config/policy';
import { seededShuffle } from '../../core/rng';

/**
 * Attestor eligibility (pure). A candidate must:
 *  1. not be either party;
 *  2. be an ACTIVE member;
 *  3. be at least 2 active graph hops from BOTH parties (unreachable counts as far enough);
 *  4. never have been a direct voucher or invitee of either party (any vouch status, any invitation);
 *  5. have no declared conflict with either party (in either direction);
 *  6. meet the attestor credibility threshold;
 *  7. not already have been selected for this dispute.
 * Graph distance alone does not guarantee independence (people know each other offline),
 * which is why declared conflicts and recusal exist.
 */
export interface Candidate {
  id: string;
  handle: string;
  displayName: string;
  status: 'ACTIVE' | 'LEFT';
  score: number;
}

export interface EligibilityContext {
  parties: { id: string; name: string }[];
  distances: Map<string, Map<string, number>>; // partyId -> (memberId -> hops)
  directRelations: Map<string, string[]>; // memberId -> party names they have a direct vouch/invite relation with
  conflicts: Map<string, string[]>; // memberId -> party names with declared conflict
  alreadySelected: Set<string>;
}

export interface EligibilityRow {
  memberId: string;
  eligible: boolean;
  reasons: string[];
  distances: Record<string, number | null>;
  score: number;
}

export function evaluateEligibility(c: Candidate, ctx: EligibilityContext): EligibilityRow {
  const reasons: string[] = [];
  const distances: Record<string, number | null> = {};
  const isParty = ctx.parties.some((p) => p.id === c.id);
  if (isParty) reasons.push('Is a party to this dispute');
  if (c.status !== 'ACTIVE') reasons.push('Has left the community');
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
  return { memberId: c.id, eligible: reasons.length === 0, reasons, distances, score: c.score };
}

/**
 * Random selection from eligible candidates. Candidates are first sorted by handle so the
 * input order is deterministic; the seeded shuffle then makes the draw reproducible from the
 * recorded seed (fixed in demo mode, random otherwise).
 */
export function selectAttestors(eligible: Candidate[], count: number, seed: string): Candidate[] {
  const ordered = [...eligible].sort((a, b) => (a.handle < b.handle ? -1 : 1));
  return seededShuffle(ordered, seed).slice(0, count);
}
