import { addDayKey, dayKeyOf } from '../../core/timezone';

/**
 * THE activity-scoring rule (pure). Used by the friends leaderboard and the community-pool
 * redistribution, so both always agree.
 *
 *   For every qualifying exchange settled on local day D between members A and B:
 *     A earns a point for (B, D) and B earns a point for (A, D).
 *   Each (member, counterparty, day) counts once — repeat exchanges with the same person on the
 *   same day add nothing. Optionally (existing anti-abuse rule) a pair can earn each other at most
 *   `maxPointsPerPairPerWindow` points per window.
 *
 * Only exchanges passed in count; the repo passes SETTLED exchanges only, so logins, page views,
 * listings, cancelled/declined/released exchanges, unresolved disputes and pool rewards never score.
 */
export interface ScoredExchange {
  id: string;
  providerId: string;
  recipientId: string;
  settledAt: Date;
}

export interface ActivityParams {
  timezone: string;
  startDay: string;
  endDay: string;
  pointsPerCounterpartyPerDay: number;
  maxPointsPerPairPerWindow: number | null;
}

export interface MemberActivity {
  memberId: string;
  points: number;
  distinctCounterparties: number;
  qualifyingExchanges: number;
  /** The (day, counterparty) pairs that earned a point, for explanations and audit snapshots. */
  credited: { day: string; counterpartyId: string }[];
}

/** Inclusive window of `days` local days ending on `endDay`. */
export function activityWindow(endDay: string, days: number) {
  return { startDay: addDayKey(endDay, -(days - 1)), endDay, days };
}

export function scoreActivity(exchanges: ScoredExchange[], p: ActivityParams): Map<string, MemberActivity> {
  // member -> counterparty -> set of days
  const days = new Map<string, Map<string, Set<string>>>();
  const exchangeCount = new Map<string, number>();
  for (const ex of exchanges) {
    if (ex.providerId === ex.recipientId) continue;
    const day = dayKeyOf(ex.settledAt, p.timezone);
    if (day < p.startDay || day > p.endDay) continue;
    for (const [me, other] of [
      [ex.providerId, ex.recipientId],
      [ex.recipientId, ex.providerId],
    ]) {
      const byOther = days.get(me) ?? new Map<string, Set<string>>();
      const set = byOther.get(other) ?? new Set<string>();
      set.add(day);
      byOther.set(other, set);
      days.set(me, byOther);
      exchangeCount.set(me, (exchangeCount.get(me) ?? 0) + 1);
    }
  }
  const out = new Map<string, MemberActivity>();
  for (const [memberId, byOther] of days) {
    const credited: MemberActivity['credited'] = [];
    for (const [counterpartyId, set] of [...byOther.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const ordered = [...set].sort();
      const cap = p.maxPointsPerPairPerWindow ?? ordered.length;
      for (const day of ordered.slice(0, cap)) credited.push({ day, counterpartyId });
    }
    out.set(memberId, {
      memberId,
      points: credited.length * p.pointsPerCounterpartyPerDay,
      distinctCounterparties: byOther.size,
      qualifyingExchanges: exchangeCount.get(memberId) ?? 0,
      credited,
    });
  }
  return out;
}

/** Standard competition ranking (1, 1, 3) by points desc; ties listed by `tieKey` asc. */
export function rankByPoints<T extends { points: number }>(rows: T[], tieKey: (r: T) => string): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || (tieKey(a) < tieKey(b) ? -1 : tieKey(a) > tieKey(b) ? 1 : 0));
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || sorted[i - 1].points !== r.points) rank = i + 1;
    return { ...r, rank };
  });
}
