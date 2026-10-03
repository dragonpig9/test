import { POLICY } from '../../config/policy';
import type { Db } from '../../core/db';
import { addDayKey, zonedTimeUtc } from '../../core/timezone';
import { loadQualifyingExchanges } from './activity.repo';
import { activityWindow, scoreActivity } from './activity.rules';

const A = POLICY.activity;
const TZ = POLICY.schedule.timezone;

/**
 * Activity scores for the window of `days` local days ending on `endDay` (inclusive), used by the
 * daily Community Credit Pool distribution (unchanged). The monthly "Friends activity" display has its
 * own module (modules/friends-activity) and never feeds the pool.
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
