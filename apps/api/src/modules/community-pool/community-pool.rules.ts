import { seededShuffle } from '../../core/rng';

/**
 * Pure community-pool rules. All amounts are INTEGER ledger units (hundredths of a credit), so the
 * arithmetic is exact — no floating point, no six-decimal approximation.
 *
 *   paymentUnits   = floor(poolUnits / recipientCount)          (each payment a multiple of 0.01, rounded DOWN)
 *   totalPaid      = paymentUnits × recipientCount
 *   remainingUnits = poolUnits − totalPaid                       (every leftover unit is retained)
 *
 * Example: pool 108.00 (10 800 units), 456 recipients → 23 units = 0.23 each, total 104.88, remaining 3.12.
 * If the pool cannot pay `minPaymentUnits` (0.01) to everyone, nothing is paid and it is all retained.
 */
export type DistributionStatus = 'PAID' | 'RETAINED_NO_ACTIVE_USERS' | 'RETAINED_TOO_SMALL';

export interface DistributionPlan {
  status: DistributionStatus;
  paymentUnits: number;
  totalPaid: number;
  remainingUnits: number;
}

export function planDistribution(poolUnits: number, recipientCount: number, minPaymentUnits = 1): DistributionPlan {
  if (!Number.isSafeInteger(poolUnits) || !Number.isSafeInteger(recipientCount) || poolUnits < 0 || recipientCount < 0) {
    throw new Error(`planDistribution needs non-negative integers (pool ${poolUnits}, recipients ${recipientCount}).`);
  }
  if (recipientCount === 0) return { status: 'RETAINED_NO_ACTIVE_USERS', paymentUnits: 0, totalPaid: 0, remainingUnits: poolUnits };
  const paymentUnits = Math.floor(poolUnits / recipientCount);
  if (paymentUnits < minPaymentUnits) return { status: 'RETAINED_TOO_SMALL', paymentUnits: 0, totalPaid: 0, remainingUnits: poolUnits };
  const totalPaid = paymentUnits * recipientCount;
  return { status: 'PAID', paymentUnits, totalPaid, remainingUnits: poolUnits - totalPaid };
}

/** ceil(activeUsers × numerator / denominator); 0 active users → 0 recipients. */
export function recipientCountFor(activeUsers: number, numerator = 1, denominator = 2): number {
  return activeUsers <= 0 ? 0 : Math.ceil((activeUsers * numerator) / denominator);
}

export interface RankedCandidate {
  memberId: string;
  points: number;
  /** Position in the date-seeded tie order (0 = first among equals). */
  tieOrder: number;
  rank: number;
  selected: boolean;
}

/**
 * Ranks active members (points > 0) by points, highest first. Equal scores are ordered by a
 * reproducible shuffle seeded with the run date (same date + same members → same order), then the top
 * `count` are selected.
 */
export function rankAndSelect(active: { memberId: string; points: number }[], count: number, seed: string): RankedCandidate[] {
  const ids = active.map((a) => a.memberId).sort();
  const order = new Map(seededShuffle(ids, seed).map((id, i) => [id, i]));
  return [...active]
    .filter((a) => a.points > 0)
    .sort((a, b) => b.points - a.points || order.get(a.memberId)! - order.get(b.memberId)!)
    .map((a, i) => ({ memberId: a.memberId, points: a.points, tieOrder: order.get(a.memberId)!, rank: i + 1, selected: i < count }));
}
