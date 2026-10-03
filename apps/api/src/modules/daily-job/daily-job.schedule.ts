import { addDayKey, dayKeyOf, zonedTimeUtc } from '../../core/timezone';

/**
 * Pure scheduling rules for the daily job (00:00 in POLICY.schedule.timezone).
 * A run is identified by its local date ("runDate"): the date whose 00:00 triggered it.
 */
export interface DueRun {
  runDate: string;
  scheduledFor: Date;
}

/** The run that is due at `now`: today's if its start time has passed, otherwise yesterday's. */
export function currentRun(now: Date, tz: string, hour: number): DueRun {
  const today = dayKeyOf(now, tz);
  const at = zonedTimeUtc(today, tz, hour);
  if (at.getTime() <= now.getTime()) return { runDate: today, scheduledFor: at };
  const y = addDayKey(today, -1);
  return { runDate: y, scheduledFor: zonedTimeUtc(y, tz, hour) };
}

/** Every scheduled start in the half-open interval (from, to], oldest first (demo clock jumps). */
export function runsBetween(from: Date, to: Date, tz: string, hour: number): DueRun[] {
  const out: DueRun[] = [];
  if (to.getTime() <= from.getTime()) return out;
  for (let k = dayKeyOf(from, tz); ; k = addDayKey(k, 1)) {
    const at = zonedTimeUtc(k, tz, hour);
    if (at.getTime() > to.getTime()) break;
    if (at.getTime() > from.getTime()) out.push({ runDate: k, scheduledFor: at });
  }
  return out;
}
