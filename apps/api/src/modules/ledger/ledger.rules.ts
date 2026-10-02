import { POLICY } from '../../config/policy';

/**
 * Pure ledger rules.
 *
 *   posted balance    = Σ posted ledger entries for the member's account
 *   available balance = posted balance − outgoing reservations (ACTIVE + FROZEN)
 *
 * A new reservation is allowed only if available − amount ≥ floor (−5 credits).
 * Example: posted 0, reserve 2 → available −2 → allowed.
 * Frozen (disputed) reservations still count, so frozen credits cannot be spent twice.
 */
export function availableBalance(posted: number, reservedOutgoing: number): number {
  return posted - reservedOutgoing;
}

export function floorCheck(posted: number, reservedOutgoing: number, amount: number) {
  const available = availableBalance(posted, reservedOutgoing);
  const after = available - amount;
  return { available, after, allowed: after >= POLICY.credits.floor, floor: POLICY.credits.floor };
}

export interface LotLike {
  id: string;
  remaining: number;
  earnedAt: Date;
  expiresAt: Date;
}

/**
 * Lot accounting. Invariant: Σ lot.remaining == max(posted, 0).
 * Earning first pays off any debt (debts never expire); only the positive part becomes a new lot.
 */
export function newLotAmount(postedBefore: number, postedAfter: number): number {
  return Math.max(postedAfter, 0) - Math.max(postedBefore, 0);
}

/** Spending (or expiring) consumes the oldest lots first until the invariant holds again. */
export function planLotConsumption(lots: LotLike[], postedAfter: number): { id: string; take: number }[] {
  const total = lots.reduce((s, l) => s + l.remaining, 0);
  let toConsume = total - Math.max(postedAfter, 0);
  const plan: { id: string; take: number }[] = [];
  const ordered = [...lots].sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime() || (a.id < b.id ? -1 : 1));
  for (const l of ordered) {
    if (toConsume <= 0) break;
    const take = Math.min(l.remaining, toConsume);
    if (take > 0) plan.push({ id: l.id, take });
    toConsume -= take;
  }
  return plan;
}
