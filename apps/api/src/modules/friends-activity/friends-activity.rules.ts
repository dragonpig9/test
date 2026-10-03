import { dayKeyOf } from '../../core/timezone';
import type { ScoredExchange } from '../activity/activity.rules';

/**
 * Monthly "Friends activity" rules (pure, unit tested).
 *
 * ACTIVITY POINTS — for each qualifying settled service (positive credit transfer) between A and B,
 * settled on Hong Kong day D in the month, A and B each get one point, unless a cap applies:
 *   - per unordered pair {A, B}: at most `perPairPerDay` point per member per local day
 *     (repeat exchanges the same day add nothing), and
 *   - at most `perPairPerMonth` points per member per calendar month from that same pair.
 * The caps are keyed by the unordered pair, so swapping provider/recipient roles or splitting a task
 * into several exchanges cannot get round them. The amount paid never changes the point.
 * Points come only from the exchanges passed in (settled, not disputed), so logins, listings,
 * cancellations, unresolved disputes and pool rewards never score; each exchange is one row, so a
 * retried settlement cannot be counted twice.
 *
 * CREDITS EARNED / SPENT — from settled service-credit transfers only (provider earns, recipient
 * spends), never from net balance change and never capped. Reversals of a settlement count negative
 * in the month they are posted.
 */
export interface MonthlyParams {
  timezone: string;
  startDay: string;
  endDay: string;
  pointsPerQualifyingExchange: number;
  perPairPerDay: number;
  perPairPerMonth: number;
}

export interface MonthlyActivity {
  memberId: string;
  points: number;
  /** One row per awarded point: the local day, the counterparty and the exchange that earned it. */
  credited: { day: string; counterpartyId: string; exchangeId: string }[];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function scoreMonthlyActivity(exchanges: ScoredExchange[], p: MonthlyParams): Map<string, MonthlyActivity> {
  const ordered = [...exchanges].sort((x, y) => x.settledAt.getTime() - y.settledAt.getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const perDay = new Map<string, number>(); // member|pair|day → points
  const perMonth = new Map<string, number>(); // member|pair → points
  const out = new Map<string, MonthlyActivity>();
  for (const ex of ordered) {
    if (ex.providerId === ex.recipientId) continue;
    const day = dayKeyOf(ex.settledAt, p.timezone);
    if (day < p.startDay || day > p.endDay) continue;
    const pair = pairKey(ex.providerId, ex.recipientId);
    for (const [me, other] of [
      [ex.providerId, ex.recipientId],
      [ex.recipientId, ex.providerId],
    ]) {
      const dKey = `${me}|${pair}|${day}`;
      const mKey = `${me}|${pair}`;
      if ((perDay.get(dKey) ?? 0) >= p.perPairPerDay) continue;
      if ((perMonth.get(mKey) ?? 0) >= p.perPairPerMonth) continue;
      perDay.set(dKey, (perDay.get(dKey) ?? 0) + 1);
      perMonth.set(mKey, (perMonth.get(mKey) ?? 0) + 1);
      const row = out.get(me) ?? { memberId: me, points: 0, credited: [] };
      row.points += p.pointsPerQualifyingExchange;
      row.credited.push({ day, counterpartyId: other, exchangeId: ex.id });
      out.set(me, row);
    }
  }
  return out;
}

export interface ServiceTransfer {
  providerId: string;
  recipientId: string;
  /** Service credits in hundredths (gift excluded). Negative for a reversal/refund. */
  units: number;
}

export function sumServiceCredits(transfers: ServiceTransfer[]): Map<string, { earned: number; spent: number }> {
  const out = new Map<string, { earned: number; spent: number }>();
  const row = (id: string) => out.get(id) ?? { earned: 0, spent: 0 };
  for (const t of transfers) {
    const p = row(t.providerId);
    p.earned += t.units;
    out.set(t.providerId, p);
    const r = row(t.recipientId);
    r.spent += t.units;
    out.set(t.recipientId, r);
  }
  return out;
}

/** Service part of a settlement: the gift is excluded (a partial settlement pays the service first). */
export function serviceUnitsOf(settled: number, creditAmount: number): number {
  return Math.max(0, Math.min(settled, creditAmount));
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** Local calendar month as inclusive day keys, plus the first day of the next month. */
export function monthDays(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return { startDay: `${year}-${pad(month)}-01`, endDay: `${year}-${pad(month)}-${pad(last)}`, nextMonthStartDay: `${next.y}-${pad(next.m)}-01` };
}

export function monthOf(now: Date, timezone: string): { year: number; month: number } {
  const [y, m] = dayKeyOf(now, timezone).split('-').map(Number);
  return { year: y, month: m };
}
