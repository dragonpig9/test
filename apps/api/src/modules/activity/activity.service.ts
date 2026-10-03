import type { LeaderboardView } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import type { Db } from '../../core/db';
import { addDayKey, dayKeyOf, zonedTimeUtc } from '../../core/timezone';
import { toSummary } from '../members/member.repo';
import { acceptedFriends } from '../trust/trust.friends';
import { loadTrust } from '../trust/trust.service';
import { loadQualifyingExchanges } from './activity.repo';
import { activityWindow, rankByPoints, scoreActivity, type MemberActivity } from './activity.rules';

const A = POLICY.activity;
const TZ = POLICY.schedule.timezone;

/**
 * Activity scores for the window of `days` local days ending on `endDay` (inclusive).
 * The ONE scoring entry point: the leaderboard and the daily pool distribution both call it.
 */
export async function activityScores(db: Db, endDay: string, days: number = A.windowDays) {
  const w = activityWindow(endDay, days);
  const from = zonedTimeUtc(w.startDay, TZ);
  const to = zonedTimeUtc(addDayKey(w.endDay, 1), TZ);
  const exchanges = await loadQualifyingExchanges(db, from, to);
  const scores = scoreActivity(exchanges, {
    timezone: TZ,
    startDay: w.startDay,
    endDay: w.endDay,
    pointsPerCounterpartyPerDay: A.pointsPerCounterpartyPerDay,
    maxPointsPerPairPerWindow: A.maxPointsPerPairPerWindow,
  });
  return { window: { ...w, timezone: TZ }, scores, exchangeCount: exchanges.length };
}

export function activityRulesText(days: number = A.windowDays): string[] {
  return [
    `Period: the last ${days} calendar days (Hong Kong time, ${TZ}), including today.`,
    `You earn ${A.pointsPerCounterpartyPerDay} point per different person you complete a settled exchange with, per day — as provider or recipient.`,
    'Repeat exchanges with the same person on the same day add no extra points.',
    ...(A.maxPointsPerPairPerWindow !== null ? [`Anti-abuse: the same two members can earn each other at most ${A.maxPointsPerPairPerWindow} points per period.`] : []),
    'Logins, page views, listings, cancelled tasks, unresolved disputes and pool rewards earn nothing.',
    'Activity points are separate from credits, credibility and relationship strength.',
  ];
}

/** 好友活躍排行榜: the member and their accepted direct friends, ranked by activity points. */
export async function friendsLeaderboard(db: Db, memberId: string, now: Date): Promise<LeaderboardView> {
  const today = dayKeyOf(now, TZ);
  const [{ window, scores }, trust] = await Promise.all([activityScores(db, today), loadTrust(db, now)]);
  const friends = await acceptedFriends(db, trust, memberId);
  const ids = [memberId, ...friends.map((f) => f.memberId)];
  const byId = new Map(trust.members.map((m) => [m.id, m]));
  const empty = (id: string): MemberActivity => ({ memberId: id, points: 0, distinctCounterparties: 0, qualifyingExchanges: 0, credited: [] });
  const rows = ids.filter((id) => byId.has(id)).map((id) => ({ ...(scores.get(id) ?? empty(id)), name: byId.get(id)!.displayName }));
  const ranked = rankByPoints(rows, (r) => r.name.toLowerCase());
  return {
    window,
    entries: ranked.map((r) => {
      const m = byId.get(r.memberId)!;
      return {
        rank: r.rank,
        member: toSummary(m),
        university: m.university ?? null,
        points: r.points,
        distinctCounterparties: r.distinctCounterparties,
        isMe: r.memberId === memberId,
      };
    }),
    rules: activityRulesText(window.days),
    generatedAt: now.toISOString(),
  };
}
