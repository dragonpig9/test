import type { MemberSummary } from '@commonhours/shared';
import clsx from 'clsx';

const COLORS = ['bg-emerald-600', 'bg-teal-600', 'bg-sky-600', 'bg-indigo-600', 'bg-fuchsia-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-700'];

export function avatarColor(handle: string) {
  let h = 0;
  for (const ch of handle) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({ m, size = 'md' }: { m: Pick<MemberSummary, 'displayName' | 'handle'>; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        avatarColor(m.handle),
        size === 'sm' && 'h-6 w-6 text-[10px]',
        size === 'md' && 'h-8 w-8 text-xs',
        size === 'lg' && 'h-12 w-12 text-base',
      )}
    >
      {m.displayName
        .split(' ')
        .map((p) => p[0])
        .join('')
        .slice(0, 2)}
    </span>
  );
}

export function MemberChip({ m, suffix }: { m: MemberSummary; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar m={m} size="sm" />
      <span className="font-medium text-slate-900">{m.displayName}</span>
      {m.status === 'LEFT' && <span className="rounded bg-slate-200 px-1.5 text-[10px] font-semibold uppercase text-slate-600">left</span>}
      {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
    </span>
  );
}
