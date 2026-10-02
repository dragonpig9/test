import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { credits, fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { advanceClock, resetDemo, switchAccount, useDemoState } from './api';

/** Clearly labelled demo controls: simulated clock, account switcher and reset. All call real backend endpoints. */
export function DemoBar({ onToggleGuide }: { onToggleGuide: () => void }) {
  const { me, signIn } = useAuth();
  const demo = useDemoState();
  const [msg, setMsg] = useState<string | null>(null);
  const sw = useAction((h: string) => switchAccount(h), (r) => signIn(r.token));
  const reset = useAction(() => resetDemo(), () => setMsg('Demo data reset to the seeded state.'));
  const adv = useAction((d: number) => advanceClock(d), (r) =>
    setMsg(
      `Clock → ${fmtDate(r.now)}. ${r.expiredCredits.length ? `Expired: ${r.expiredCredits.map((e) => `${e.name} ${credits(e.amount)}`).join(', ')}. ` : ''}${r.expiredVouches ? `${r.expiredVouches} vouch(es) expired. ` : ''}${r.disputesNeedingReview ? `${r.disputesNeedingReview} dispute(s) hit their deadline.` : ''}`,
    ),
  );
  if (!demo.data) return null;
  const err = sw.error ?? reset.error ?? adv.error;
  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
        <span className="rounded-md bg-amber-200 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">Demo mode</span>
        <span className="num" title="All business rules use this simulated clock">
          <span className="font-medium">Simulated clock:</span> {fmtDate(demo.data.now)}
        </span>
        <span className="flex items-center gap-1" role="group" aria-label="Advance simulated clock">
          {[1, 7, 30].map((d) => (
            <button key={d} type="button" className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-amber-100 disabled:opacity-50" disabled={adv.isPending} onClick={() => adv.mutate(d)}>
              +{d}d
            </button>
          ))}
        </span>
        <label className="flex items-center gap-2">
          <span className="font-medium">Demo account switcher:</span>
          <select className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm" value={me?.member.handle ?? ''} onChange={(e) => sw.mutate(e.target.value)} aria-label="Act as demo member">
            {demo.data.members.map((m) => (
              <option key={m.id} value={m.handle}>
                {m.displayName}
                {m.isBootstrap ? ' (bootstrap)' : ''}
                {m.status === 'LEFT' ? ' (left)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onToggleGuide} className="rounded-md bg-amber-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-950">
            Demo guide
          </button>
          <button
            type="button"
            className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50"
            disabled={reset.isPending}
            onClick={() => window.confirm('Reset all demo data to the seeded state? Everything done in this demo will be erased.') && reset.mutate(undefined)}
          >
            {reset.isPending ? 'Resetting…' : 'Reset demo'}
          </button>
        </div>
      </div>
      {(msg || err) && (
        <div className="mx-auto max-w-7xl px-4 pb-2 text-xs" role="status">
          {err ? <span className="text-red-800">{(err as Error).message}</span> : msg}
          <button type="button" className="ml-2 underline" onClick={() => { setMsg(null); sw.reset(); reset.reset(); adv.reset(); }}>
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}
