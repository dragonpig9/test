import { formatCredits } from '@commonhours/shared';

/** All times are shown in UTC so they line up with the simulated demo clock. */
export function fmtDate(iso: string | null | undefined, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleString('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }) + (withTime ? ' UTC' : '')
  );
}

export function credits(units: number | null | undefined, signed = false) {
  if (units === null || units === undefined) return '—';
  const s = formatCredits(units);
  return signed && units > 0 ? `+${s}` : s;
}

export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
}

/** datetime-local value (interpreted as UTC) <-> ISO. */
export function toLocalInput(iso: string) {
  return iso.slice(0, 16);
}
export function fromLocalInput(v: string) {
  return new Date(`${v}:00.000Z`).toISOString();
}

export function relDays(fromIso: string, toIso: string) {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
