import type { FriendsActivityView } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import type { Db } from '../../core/db';
import { AppError } from '../../core/errors';
import { zonedTimeUtc } from '../../core/timezone';
import { loadQualifyingExchanges } from '../activity/activity.repo';
import { rankByPoints } from '../activity/activity.rules';
import { toSummary } from '../members/member.repo';
import { acceptedFriends } from '../trust/trust.friends';
import { loadTrust } from '../trust/trust.service';
import { firstYear, loadServiceTransfers } from './friends-activity.repo';
import { MONTH_NAMES, monthDays, monthOf, scoreMonthlyActivity, sumServiceCredits } from './friends-activity.rules';

/**
 * "Friends activity": the member and their accepted direct friends for one Hong Kong calendar month.
 * READ-ONLY: computing any month (current or historical) writes nothing and is never used by balances,
 * eligibility, the pool or background jobs.
 */
const MODULE = 'friends-activity';
const TZ = POLICY.schedule.timezone;
const FA = POLICY.friendsActivity;

/** Scores for one calendar month (shared with the badges module). */
export async function monthlyScores(db: Db, year: number, month: number) {
  const days = monthDays(year, month);
  const from = zonedTimeUtc(days.startDay, TZ);
  const to = zonedTimeUtc(days.nextMonthStartDay, TZ);
  const [exchanges, transfers] = await Promise.all([loadQualifyingExchanges(db, from, to), loadServiceTransfers(db, from, to)]);
  const points = scoreMonthlyActivity(exchanges, {
    timezone: TZ,
    startDay: days.startDay,
    endDay: days.endDay,
    pointsPerQualifyingExchange: FA.pointsPerQualifyingExchange,
    perPairPerDay: FA.maxPointsPerPairPerDay,
    perPairPerMonth: FA.maxPointsPerPairPerMonth,
  });
  return { days, points, credits: sumServiceCredits(transfers) };
}

export function friendsActivityRules(): string[] {
  return [
    `Each settled exchange that pays credits gives both people ${FA.pointsPerQualifyingExchange} point, as provider or recipient.`,
    `With the same person: at most ${FA.maxPointsPerPairPerDay} point per Hong Kong day and ${FA.maxPointsPerPairPerMonth} points per month, whoever paid whom.`,
    'Bigger payments do not earn extra points. Logins, listings, cancelled tasks, open disputes and pool rewards earn nothing.',
    'Credits earned and spent come from settled exchanges (gifts, pool rewards and expiry are not included) and keep counting after the point caps.',
    'Points are separate from credits, credibility and relationship strength.',
  ];
}

export function parseMonth(q: { year?: unknown; month?: unknown }, now: Date) {
  const cur = monthOf(now, TZ);
  const year = q.year === undefined || q.year === '' ? cur.year : Number(q.year);
  const month = q.month === undefined || q.month === '' ? cur.month : Number(q.month);
  if (!Number.isInteger(year) || year < 2000 || year > cur.year + 1 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('VALIDATION_FAILED', 'Choose a month (1–12) and a year.', MODULE, undefined, 400);
  }
  return { year, month };
}

export async function friendsActivity(db: Db, memberId: string, year: number, month: number, now: Date): Promise<FriendsActivityView> {
  const cur = monthOf(now, TZ);
  const [{ days, points, credits }, trust, earliest] = await Promise.all([monthlyScores(db, year, month), loadTrust(db, now), firstYear(db)]);
  const friends = await acceptedFriends(db, trust, memberId);
  const byId = new Map(trust.members.map((m) => [m.id, m]));
  const ids = [memberId, ...friends.map((f) => f.memberId)].filter((id) => byId.has(id));
  const rows = ids.map((id) => ({
    memberId: id,
    name: byId.get(id)!.displayName,
    points: points.get(id)?.points ?? 0,
    creditsEarned: credits.get(id)?.earned ?? 0,
    creditsSpent: credits.get(id)?.spent ?? 0,
  }));
  const ranked = rankByPoints(rows, (r) => r.name.toLowerCase());
  const from = Math.min(earliest ?? cur.year, year);
  return {
    label: 'Friends activity',
    year,
    month,
    monthName: MONTH_NAMES[month - 1],
    timezone: TZ,
    startDay: days.startDay,
    endDay: days.endDay,
    isCurrentMonth: year === cur.year && month === cur.month,
    years: Array.from({ length: cur.year - from + 1 }, (_, i) => cur.year - i),
    entries: ranked.map((r) => {
      const m = byId.get(r.memberId)!;
      return { rank: r.rank, member: toSummary(m), university: m.university ?? null, points: r.points, creditsEarned: r.creditsEarned, creditsSpent: r.creditsSpent, isMe: r.memberId === memberId };
    }),
    rules: friendsActivityRules(),
    generatedAt: now.toISOString(),
  };
}
