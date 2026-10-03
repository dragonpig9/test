import type { MemberSummary } from '@commonhours/shared';
import clsx from 'clsx';

const COLORS = ['bg-emerald-600', 'bg-teal-600', 'bg-sky-600', 'bg-indigo-600', 'bg-fuchsia-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-700'];

export function avatarColor(handle: string) {
  let h = 0;
  for (const ch of handle) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({ m, size = 'md' }: { m: Pick<MemberSummary, 'displayName' | 'handle'> & { photoUrl?: string | null }; size?: 'sm' | 'md' | 'lg' }) {
  if (m.photoUrl) {
    return (
      <img
        src={m.photoUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={clsx('shrink-0 rounded-full object-cover', size === 'sm' && 'h-6 w-6', size === 'md' && 'h-8 w-8', size === 'lg' && 'h-12 w-12')}
      />
    );
  }
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

/** Contact-verification badge. "Verified" only when a code was really delivered and confirmed. */
export function VerifiedBadge({ status }: { status?: MemberSummary['contactVerification'] }) {
  if (status === 'VERIFIED')
    return (
      <span className="rounded bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800" title="Contact verified with a one-time code">
        ✓ verified contact
      </span>
    );
  if (status === 'DEMO_VERIFIED')
    return (
      <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900" title="Demo only: the code was shown on screen, not delivered by email">
        demo-verified
      </span>
    );
  return null;
}

export function MemberChip({ m, suffix, detail }: { m: MemberSummary; suffix?: string; detail?: boolean }) {
  const extra = detail ? [m.affiliation, m.neighborhood].filter(Boolean).join(' · ') : '';
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar m={m} size="sm" />
      <span className="font-medium text-slate-900">{m.displayName}</span>
      {m.status === 'LEFT' && <span className="rounded bg-slate-200 px-1.5 text-[10px] font-semibold uppercase text-slate-600">left</span>}
      {detail && <VerifiedBadge status={m.contactVerification} />}
      {extra && <span className="text-xs text-slate-500">{extra}</span>}
      {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
    </span>
  );
}
