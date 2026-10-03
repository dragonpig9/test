import { POLICY } from '../../config/policy';
import { addMonths, daysBetween } from '../../core/dates';

/**
 * Earned relationships (pure rules, unit tested).
 *
 * Earned trust comes ONLY from exchanges both members confirmed in full (mutual confirmation).
 * It is a separate edge kind from vouches: it is never created by an invitation and carries no
 * voucher liability.
 *
 *   first eligible exchange → strength = initialStrength (0.2)
 *   later ones              → strength = min(maxStrength, old + gainRate × (1 − old))
 *                             = min(0.7, old + 0.10 × (1 − old))
 * Limits so two accounts cannot manufacture unlimited trust:
 *   - a hard cap (0.7) below a full vouch (1.0); gains shrink as the strength approaches 1;
 *   - at most maxCountedPerWindow (2) increases per pair per windowDays (30); further exchanges
 *     are recorded but change nothing;
 *   - credibility is unaffected by earned edges (completed services are already capped at 10).
 * Earned edges decay ×0.5 after 12 months without an exchange and expire after 18 (same as vouches).
 */
const E = POLICY.earnedTrust;

export interface EarnedState {
  strength: number;
  lastExchangeAt: Date;
}

export interface EffectiveEarned {
  status: 'ACTIVE' | 'EXPIRED';
  effectiveStrength: number;
  decayed: boolean;
  explanation: string;
}

export function effectiveEarned(e: EarnedState, now: Date): EffectiveEarned {
  if (addMonths(e.lastExchangeAt, POLICY.vouches.expireAfterMonths).getTime() <= now.getTime()) {
    return { status: 'EXPIRED', effectiveStrength: 0, decayed: false, explanation: `Expired: no confirmed exchange for ${POLICY.vouches.expireAfterMonths} months.` };
  }
  if (addMonths(e.lastExchangeAt, POLICY.vouches.decayAfterMonths).getTime() <= now.getTime()) {
    const eff = round4(e.strength * POLICY.vouches.decayFactor);
    return {
      status: 'ACTIVE',
      effectiveStrength: eff,
      decayed: true,
      explanation: `Decayed: last confirmed exchange ${daysBetween(e.lastExchangeAt, now)} days ago. ${e.strength} × ${POLICY.vouches.decayFactor} = ${eff}.`,
    };
  }
  return { status: 'ACTIVE', effectiveStrength: e.strength, decayed: false, explanation: `Earned through confirmed exchanges; last one ${e.lastExchangeAt.toISOString().slice(0, 10)}.` };
}

export interface EarnedStep {
  previousStrength: number;
  newStrength: number;
  applied: boolean;
  reason: string;
}

/**
 * Next strength after one more eligible exchange.
 * `current` is null for a pair with no earned relationship yet; `countedInWindow` is the number of
 * increases already applied to this pair in the last windowDays.
 */
export function nextEarnedStrength(current: EarnedState | null, countedInWindow: number, now: Date): EarnedStep {
  if (!current) {
    return {
      previousStrength: 0,
      newStrength: E.initialStrength,
      applied: true,
      reason: `First exchange both members confirmed: a new earned relationship starts at ${E.initialStrength}.`,
    };
  }
  const eff = effectiveEarned(current, now);
  // A decayed or expired edge restarts from its effective value (an expired one from the initial strength).
  const base = eff.status === 'EXPIRED' ? 0 : eff.effectiveStrength;
  if (countedInWindow >= E.maxCountedPerWindow) {
    return {
      previousStrength: base,
      newStrength: base,
      applied: false,
      reason: `No increase: at most ${E.maxCountedPerWindow} exchanges per pair count in any ${E.windowDays}-day window (limit on repeated exchanges between the same two accounts).`,
    };
  }
  if (base === 0) {
    return { previousStrength: 0, newStrength: E.initialStrength, applied: true, reason: `Relationship had expired; restarting at ${E.initialStrength}.` };
  }
  if (base >= E.maxStrength) {
    return { previousStrength: base, newStrength: base, applied: false, reason: `No increase: earned relationships are capped at ${E.maxStrength} (a full vouch is 1.0).` };
  }
  const next = round4(Math.min(E.maxStrength, base + E.gainRate * (1 - base)));
  return {
    previousStrength: base,
    newStrength: next,
    applied: true,
    reason: `${base} + ${E.gainRate} × (1 − ${base}) = ${round4(base + E.gainRate * (1 - base))}${next < round4(base + E.gainRate * (1 - base)) ? `, capped at ${E.maxStrength}` : ''}${eff.decayed ? ' (started from the decayed value)' : ''}.`,
  };
}

/** Canonical pair order so each pair has one row. */
export function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
