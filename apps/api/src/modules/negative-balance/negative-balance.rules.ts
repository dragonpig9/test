import { DAY_MS } from '../../core/dates';

/**
 * Pure rules for continuous negative POSTED balances.
 *
 *  - A period opens when the posted balance crosses from ≥ 0 to < 0 (negativeSince = that moment).
 *  - It closes only when the posted balance reaches ≥ 0. Partial repayment while still negative
 *    changes nothing (the timer keeps running).
 *  - Reservations never change the posted balance, so they can never open a period.
 *  - Reminder: strictly MORE than `reminderAfterDays` days (exactly 50 days does not trigger).
 */
export type PeriodTransition = 'open' | 'close' | 'none';

export function periodTransition(before: number, after: number): PeriodTransition {
  if (before >= 0 && after < 0) return 'open';
  if (before < 0 && after >= 0) return 'close';
  return 'none';
}

/**
 * Reconstructs when the CURRENT negative run started from ledger history (oldest first).
 * Returns null when the final balance is not negative (or there is no history).
 */
export function reconstructNegativeSince(entries: { amount: number; effectiveAt: Date }[]): Date | null {
  let running = 0;
  let since: Date | null = null;
  for (const e of entries) {
    const before = running;
    running += e.amount;
    const t = periodTransition(before, running);
    if (t === 'open') since = e.effectiveAt;
    if (t === 'close') since = null;
  }
  return running < 0 ? since : null;
}

export function negativeDays(negativeSince: Date, now: Date): number {
  return (now.getTime() - negativeSince.getTime()) / DAY_MS;
}

export function reminderDue(negativeSince: Date, now: Date, afterDays: number): boolean {
  return now.getTime() - negativeSince.getTime() > afterDays * DAY_MS;
}

/** Up to `max` closest friends (input already sorted strongest first). */
export function closestFriends<T extends { strength: number }>(friends: T[], max: number): T[] {
  return friends.filter((f) => f.strength > 0).slice(0, max);
}
