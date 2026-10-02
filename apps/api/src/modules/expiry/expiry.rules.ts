import type { LotLike } from '../ledger/ledger.rules';

/**
 * Credit expiry rule (pure).
 * Lots older than 12 months expire, EXCEPT units that back an open outgoing reservation.
 * Reservations are notionally funded by the oldest lots (FIFO), so the first
 * `reservedOutgoing` units in date order are protected until the reservation resolves.
 *
 *   expirable = max(0, Σ expired-lot remaining − reservedOutgoing)
 *
 * Negative balances (debts) have no lots and never expire.
 */
export function expirableAmount(lots: LotLike[], reservedOutgoing: number, now: Date): number {
  const ordered = [...lots].sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime());
  let protect = reservedOutgoing;
  let expirable = 0;
  for (const l of ordered) {
    const p = Math.min(protect, l.remaining);
    protect -= p;
    if (l.expiresAt.getTime() <= now.getTime()) expirable += l.remaining - p;
  }
  return Math.max(0, expirable);
}
