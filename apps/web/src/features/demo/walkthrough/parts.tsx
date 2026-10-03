import clsx from 'clsx';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ExchangeView, MemberSummary } from '@commonhours/shared';
import { Avatar } from '../../../components/MemberChip';
import { Button, ErrorBox, Loading, StatusChip } from '../../../components/ui';
import { Timeline } from '../../../components/Timeline';
import { useAuth } from '../../../lib/auth';
import { credits, duration, fmtDate } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';
import { useExchange } from '../../exchanges/api';
import { ACTION_LABEL, useExchangeAction } from '../../exchanges/ExchangeActions';
import { TrustUpdateCard } from '../../trust-graph/TrustUpdateCard';
import { advanceClock, switchAccount } from '../api';

/** Switches the acting demo member through the existing backend-authorised demo switcher. */
export function useActAs() {
  const { me, signIn } = useAuth();
  const sw = useAction((handle: string) => switchAccount(handle), (r) => signIn(r.token));
  return { me: me?.member, switchTo: (h: string) => sw.mutate(h), pending: sw.isPending ? sw.variables : null, error: sw.error };
}

/** One-click participant change, or a label when this member is already acting. */
export function ActAsButton({ m, why }: { m: Pick<MemberSummary, 'handle' | 'displayName'>; why?: string }) {
  const { me, switchTo, pending } = useActAs();
  if (me?.handle === m.handle) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-900">
        <Avatar m={m} size="sm" /> Acting as {m.displayName.split(' ')[0]}
      </span>
    );
  }
  return (
    <Button variant="secondary" className="!px-2.5 !py-1 text-xs" busy={pending === m.handle} onClick={() => switchTo(m.handle)} title={why}>
      <Avatar m={m} size="sm" /> Act as {m.displayName.split(' ')[0]}
      {why && <span className="font-normal text-slate-500">· {why}</span>}
    </Button>
  );
}

/** Shown before a member acts (votes, accepts) so nobody acts on someone else's behalf by accident. */
export function ActingBanner({ m, doing }: { m: MemberSummary; doing: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-violet-300 bg-violet-50 p-2.5 text-sm text-violet-950" role="status">
      <Avatar m={m} size="sm" />
      <span>
        Acting as <strong>{m.displayName}</strong> — {doing}
      </span>
    </div>
  );
}

export type StepState = 'done' | 'ready' | 'waiting' | 'blocked' | 'info';
const STATE_LABEL: Record<StepState, string> = { done: 'Saved result', ready: 'Ready', waiting: 'Waiting', blocked: 'Blocked', info: 'From records' };

/** A labelled step inside a chapter. Its state always comes from backend records. */
export function Step({ title, state, children, note }: { title: string; state: StepState; children?: ReactNode; note?: ReactNode }) {
  return (
    <section className={clsx('rounded-2xl border bg-white p-4 shadow-sm', state === 'ready' ? 'border-brand-300 ring-1 ring-brand-200' : 'border-slate-200')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-base">{title}</h2>
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            state === 'done' && 'bg-emerald-100 text-emerald-900',
            state === 'ready' && 'bg-brand-700 text-white',
            state === 'waiting' && 'bg-slate-100 text-slate-700',
            state === 'blocked' && 'bg-red-50 text-red-800',
            state === 'info' && 'bg-sky-50 text-sky-800',
          )}
        >
          {STATE_LABEL[state]}
        </span>
      </div>
      {note && <p className="mb-2 text-sm text-slate-600">{note}</p>}
      {children}
    </section>
  );
}

/** The small "Details" panel: full calculations and tables, collapsed by default. */
export function Details({ children, title = 'Details' }: { children: ReactNode; title?: string }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm">
      <summary className="cursor-pointer select-none font-medium text-brand-800">
        {title} <span className="text-xs font-normal text-slate-500 group-open:hidden">(show)</span>
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

/** A labelled concept box (backing, earned relationship, credibility, eligibility). */
export function Concept({ label, tone, title, children }: { label: string; tone: 'teal' | 'violet' | 'amber' | 'sky'; title: ReactNode; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'rounded-xl border p-3',
        tone === 'teal' && 'border-teal-200 bg-teal-50/50',
        tone === 'violet' && 'border-violet-200 bg-violet-50/50',
        tone === 'amber' && 'border-amber-200 bg-amber-50/50',
        tone === 'sky' && 'border-sky-200 bg-sky-50/50',
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

// The last clock change stays visible after the control that made it disappears (the service became due).
let clockNote: string | null = null;
const listeners = new Set<() => void>();
const setClockNote = (n: string | null) => {
  clockNote = n;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** What the last clock change did, including daily-job runs, shown until dismissed. */
export function ClockNote() {
  const note = useSyncExternalStore(subscribe, () => clockNote);
  if (!note) return null;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950" role="status">
      <strong>Simulated time changed.</strong> {note}{' '}
      <button type="button" className="underline" onClick={() => setClockNote(null)}>
        Dismiss
      </button>
    </div>
  );
}

/**
 * Explicit simulated-clock control (the same backend endpoint as the demo bar). Never runs on its own.
 * The clock is shared by everyone using this demo server.
 */
export function ClockControl({ why }: { why: string }) {
  const adv = useAction(
    () => advanceClock(1),
    (r) => {
      const runs = r.dailyJobs.filter((j) => j.status === 'COMPLETED');
      setClockNote(
        `The clock moved to ${fmtDate(r.now)}.` +
          (r.expiredCredits.length ? ` Expired into the Community Credit Pool: ${r.expiredCredits.map((e) => `${e.name} ${credits(e.amount)}`).join(', ')}.` : '') +
          (runs.length ? ` The 00:00 Hong Kong daily job ran for ${runs.map((j) => j.runDate).join(', ')}; any pool rewards it paid are listed separately from service transfers.` : ''),
      );
    },
  );
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">Simulated time</p>
      <p className="mt-1 text-xs leading-relaxed">
        {why} The demo uses one shared simulated clock for everyone on this server. Moving it forward also runs the normal time-based rules: credit
        expiry, vouch decay, dispute deadlines and the 00:00 Hong Kong daily job (which can pay Community Credit Pool rewards).
      </p>
      <Button className="mt-2" variant="secondary" busy={adv.isPending} onClick={() => adv.mutate(undefined)}>
        Advance the shared clock by 1 day
      </Button>
      <div className="mt-2">
        <ErrorBox error={adv.error} title="The clock was not moved" />
      </div>
    </div>
  );
}

/** Who still has to act on an exchange, read from its recorded acceptances and confirmations. */
export function waitingOn(e: ExchangeView): MemberSummary[] {
  if (e.status === 'PROPOSED') return [e.provider, e.recipient].filter((m) => (m.id === e.provider.id ? !e.providerAcceptedAt : !e.recipientAcceptedAt));
  if (e.status === 'ACCEPTED') return [e.provider, e.recipient].filter((m) => (m.id === e.provider.id ? !e.providerConfirmedAt : !e.recipientConfirmedAt));
  return [];
}

const RES_NOTE: Record<string, string> = {
  ACTIVE: 'Reserved: counts against the payer’s available balance; nobody has been paid yet.',
  FROZEN: 'Frozen by a dispute: still reserved, cannot be paid or spent until the outcome.',
  SETTLED: 'Paid to the provider.',
  RELEASED: 'Released back to the payer without payment.',
};

/**
 * One exchange as a compact card with its own terms, reservation and the backend's allowed actions for the
 * acting member. Completed exchanges show their saved result ("View result"); nothing is repeated.
 */
export function ExchangePanel({ id, title, allow, children }: { id: string; title: string; allow: string[]; children?: ReactNode }) {
  const q = useExchange(id);
  const act = useExchangeAction(q.data?.exchange);
  const { me } = useActAs();
  const [open, setOpen] = useState(false);
  if (q.isLoading) return <Loading label="Loading the exchange…" />;
  if (q.error || !q.data) {
    return (
      <div className="space-y-2">
        <ErrorBox error={q.error} title="Could not load this exchange" />
        <Button variant="secondary" onClick={() => void q.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  const e = q.data.exchange;
  const r = e.reservation;
  const finished = ['SETTLED', 'RELEASED', 'CANCELLED', 'DECLINED', 'WITHDRAWN'].includes(e.status);
  const actions = e.myRole === 'observer' ? [] : e.actions.filter((a) => allow.includes(a.key));
  const waiting = waitingOn(e);
  // Only point at the next actor for the steps this panel handles (accepting, or confirming completion).
  const relevant = e.status === 'PROPOSED' ? allow.includes('accept') || allow.includes('approveHomeAccess') : allow.includes('confirm');
  const othersWaiting = relevant ? waiting.filter((m) => m.handle !== me?.handle) : [];
  const who = (m: MemberSummary, at: string | null) => (
    <span className="whitespace-nowrap">
      {m.displayName.split(' ')[0]} {at ? '✓' : '—'}
    </span>
  );
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-slate-900">{title}</p>
        <StatusChip status={e.status} />
        <span className="ml-auto text-lg font-semibold num text-brand-800">{credits(e.creditAmount + e.giftBonus)} cr</span>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {e.provider.displayName} provides → {e.recipient.displayName} pays · {duration(e.durationMinutes)} · {fmtDate(e.scheduledAt)} · punctuality {e.punctualityRequired ? 'is an agreed condition' : 'not a condition'} · terms v{e.termsVersion}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Accepted</dt>
          <dd className="flex flex-wrap gap-x-2">
            {who(e.provider, e.providerAcceptedAt)} {who(e.recipient, e.recipientAcceptedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Completed (confirmed)</dt>
          <dd className="flex flex-wrap gap-x-2">
            {who(e.provider, e.providerConfirmedAt)} {who(e.recipient, e.recipientConfirmedAt)}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-slate-500">Credit reservation</dt>
          <dd>{r ? <span><StatusChip status={r.status} /> {credits(r.total)} — {r.resolutionNote ?? RES_NOTE[r.status] ?? ''}</span> : 'None until both accept the same terms.'}</dd>
        </div>
      </dl>
      {children}
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.key} variant={['decline', 'withdraw', 'cancel'].includes(a.key) ? 'secondary' : 'primary'} disabled={!a.allowed} title={a.reason ?? undefined} busy={act.isPending && act.variables === a.key} onClick={() => act.mutate(a.key)}>
              {ACTION_LABEL[a.key] ?? a.key} <span className="font-normal opacity-80">(as {e.myRole === 'provider' ? e.provider.displayName.split(' ')[0] : e.recipient.displayName.split(' ')[0]})</span>
            </Button>
          ))}
        </div>
      )}
      {actions.some((a) => a.reason) && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
          {actions.filter((a) => a.reason).map((a) => (
            <li key={a.key}>
              <strong>{ACTION_LABEL[a.key] ?? a.key}:</strong> {a.reason}
            </li>
          ))}
        </ul>
      )}
      {!finished && othersWaiting.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>Waiting for {waiting.map((m) => m.displayName.split(' ')[0]).join(' and ')} to {e.status === 'PROPOSED' ? 'accept' : 'confirm completion'}.</span>
          {othersWaiting.map((m) => (
            <ActAsButton key={m.id} m={m} />
          ))}
        </div>
      )}
      {finished && (
        <div className="mt-3">
          <Button variant="ghost" className="!px-0" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide result' : 'View result'}
          </Button>
          {open && (
            <div className="mt-2 space-y-3">
              {q.data.trustUpdate && <TrustUpdateCard u={q.data.trustUpdate} title="Earned trust from this exchange (saved)" />}
              <Timeline entries={q.data.timeline} />
            </div>
          )}
        </div>
      )}
      <div className="mt-2">
        <ErrorBox error={act.error} />
      </div>
    </div>
  );
}
