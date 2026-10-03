/**
 * Calendar-day helpers for a named IANA time zone (default Asia/Hong_Kong, see POLICY.schedule).
 * A "day key" is a local calendar date as "YYYY-MM-DD". Works for zones with DST too.
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    fmtCache.set(tz, f);
  }
  return f;
}

function parts(d: Date, tz: string) {
  const o: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Local calendar date of an instant, e.g. 2026-10-01T17:00Z → "2026-10-02" in Hong Kong (UTC+8). */
export function dayKeyOf(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Offset of `tz` from UTC at instant `d`, in ms (Hong Kong: +8h). */
function offsetMs(d: Date, tz: string): number {
  const p = parts(d, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant of local `hour`:00 on `dayKey` in `tz`. */
export function zonedTimeUtc(dayKey: string, tz: string, hour = 0): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  let t = guess - offsetMs(new Date(guess), tz);
  // Second pass settles DST transitions.
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

/** dayKey ± n calendar days. */
export function addDayKey(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Inclusive list of day keys from `start` to `end`. */
export function dayKeysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let k = start; k <= end; k = addDayKey(k, 1)) out.push(k);
  return out;
}
