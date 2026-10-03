import type { Vouch } from '@prisma/client';
import type { VouchStatus } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import { addMonths, daysBetween } from '../../core/dates';

/**
 * Edge lifecycle rules (pure functions, unit tested):
 *
 *  - An edge only counts for reachability while ACTIVE and before `expiresAt`.
 *  - `expiresAt` = last qualifying interaction + 18 months (POLICY.vouches.expireAfterMonths).
 *  - BACKING: the voucher's liability raises how much the vouch counts:
 *    backedStrength = min(1, strength × liability multiplier) (POLICY.vouches.liabilityStrengthMultipliers).
 *  - DECAY: after 12 months without a qualifying interaction the backed strength is
 *    multiplied by 0.5 (POLICY.vouches.decayFactor). Stored strength is unchanged.
 *  - A qualifying interaction = an exchange between the two members that SETTLES.
 *    It refreshes the timers only; it never creates a new edge or raises strength.
 *  - Strength only rises through an explicit amendment both parties consent to.
 */
export interface EffectiveEdge {
  status: VouchStatus;
  /** min(1, strength × liability multiplier), before any decay. */
  backedStrength: number;
  effectiveStrength: number;
  decayed: boolean;
  idleSince: Date | null;
  explanation: string;
}

export type EdgeLike = Pick<Vouch, 'status' | 'strength' | 'liabilityPct' | 'activatedAt' | 'lastInteractionAt' | 'expiresAt' | 'endReason'>;

export function idleSince(v: EdgeLike): Date | null {
  return v.lastInteractionAt ?? v.activatedAt ?? null;
}

/** Strength multiplier for a liability %. Unlisted values use the highest listed % not above them. */
export function liabilityMultiplier(liabilityPct: number): number {
  const table = POLICY.vouches.liabilityStrengthMultipliers;
  const pct = Object.keys(table)
    .map(Number)
    .filter((p) => p <= liabilityPct)
    .sort((a, b) => b - a)[0];
  return pct === undefined ? 1 : table[pct];
}

export function backedStrength(strength: number, liabilityPct: number): number {
  return round2(Math.min(1, strength * liabilityMultiplier(liabilityPct)));
}

function backingText(v: EdgeLike, backed: number): string {
  const m = liabilityMultiplier(v.liabilityPct);
  if (m === 1) return `${v.strength}`;
  return `min(1, ${v.strength} × ${m} for ${v.liabilityPct}% liability) = ${backed}`;
}

export function effectiveEdge(v: EdgeLike, now: Date): EffectiveEdge {
  const since = idleSince(v);
  const backed = backedStrength(v.strength, v.liabilityPct);
  if (v.status !== 'ACTIVE') {
    return {
      status: v.status,
      backedStrength: backed,
      effectiveStrength: 0,
      decayed: false,
      idleSince: since,
      explanation: `Edge is ${v.status.toLowerCase()}${v.endReason ? ` (${v.endReason})` : ''}; it does not establish reachability.`,
    };
  }
  if (v.expiresAt && v.expiresAt.getTime() <= now.getTime()) {
    return {
      status: 'EXPIRED',
      backedStrength: backed,
      effectiveStrength: 0,
      decayed: false,
      idleSince: since,
      explanation: `Expired on ${v.expiresAt.toISOString().slice(0, 10)}: no qualifying interaction for ${POLICY.vouches.expireAfterMonths} months.`,
    };
  }
  if (since && addMonths(since, POLICY.vouches.decayAfterMonths).getTime() <= now.getTime()) {
    const eff = round2(backed * POLICY.vouches.decayFactor);
    return {
      status: 'ACTIVE',
      backedStrength: backed,
      effectiveStrength: eff,
      decayed: true,
      idleSince: since,
      explanation: `Decayed: no qualifying interaction since ${since.toISOString().slice(0, 10)} (${daysBetween(since, now)} days). ${backed} × ${POLICY.vouches.decayFactor} = ${eff} (backed strength ${backingText(v, backed)}).`,
    };
  }
  return {
    status: 'ACTIVE',
    backedStrength: backed,
    effectiveStrength: backed,
    decayed: false,
    idleSince: since,
    explanation: `Active at full strength ${backingText(v, backed)}; last qualifying interaction ${since ? since.toISOString().slice(0, 10) : 'n/a'}.`,
  };
}

/** Maximum credibility penalty the voucher accepts for a final nonperformance finding against the vouchee. */
export function maxPenaltyPoints(liabilityPct: number): number {
  return Math.round((liabilityPct / 100) * POLICY.vouches.maxLiabilityPoints);
}

export function nextStrengthUp(s: number): number | null {
  const levels = POLICY.vouches.allowedStrengths as readonly number[];
  const i = levels.findIndex((l) => Math.abs(l - s) < 1e-9);
  return i >= 0 && i < levels.length - 1 ? levels[i + 1] : null;
}

export function refreshedExpiry(at: Date): Date {
  return addMonths(at, POLICY.vouches.expireAfterMonths);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function vouchTermsText(strength: number, liabilityPct: number): string[] {
  return [
    `Strength ${strength} describes how well the voucher knows the member. It is used only to compute connection strength — it is not a guarantee.`,
    `Liability ${liabilityPct}%: if a FINAL attestation finds that the vouched member did not perform an agreed service, the voucher's credibility drops by up to ${maxPenaltyPoints(liabilityPct)} points (${liabilityPct}% × ${POLICY.vouches.maxLiabilityPoints}).`,
    'Liability never moves time credits and never cascades beyond the direct voucher.',
    `The edge decays after ${POLICY.vouches.decayAfterMonths} months and expires after ${POLICY.vouches.expireAfterMonths} months without a settled exchange between the two members.`,
    'Either party can revoke the vouch at any time. Revocation does not erase liability for exchanges already accepted.',
    'Increasing strength or liability later requires fresh consent from both parties.',
  ];
}
