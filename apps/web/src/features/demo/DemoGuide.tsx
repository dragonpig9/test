import clsx from 'clsx';
import { useAuth } from '../../lib/auth';
import { useAction } from '../../lib/mutations';
import { switchAccount, useDemoState } from './api';

/** Next-step demo guide. Step completion is computed by the backend from real records. */
export function DemoGuide({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const demo = useDemoState();
  const { me, signIn } = useAuth();
  const sw = useAction((h: string) => switchAccount(h), (r) => signIn(r.token));
  if (!demo.data) return null;
  const next = demo.data.guide.find((s) => !s.done);
  return (
    <div className={clsx(!inline && 'fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl')} aria-label="Demo guide">
      <div className="mb-3 flex items-center justify-between">
        <h2>Demo guide</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close demo guide">
            ✕
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-slate-500">Progress is detected from the database, so it only advances when real backend actions happen.</p>
      <ol className="space-y-2">
        {demo.data.guide.map((s) => {
          const isNext = s.n === next?.n;
          return (
            <li key={s.n} className={clsx('rounded-xl border p-3', isNext ? 'border-brand-300 bg-brand-50' : 'border-slate-200', s.done && 'opacity-70')}>
              <div className="flex items-start gap-2">
                <span className={clsx('mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', s.done ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-700')} aria-label={s.done ? 'done' : 'to do'}>
                  {s.done ? '✓' : s.n}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{s.title}</p>
                  {(isNext || !s.done) && <p className="mt-1 text-xs leading-relaxed text-slate-700">{s.instruction}</p>}
                  <p className="mt-1 text-[11px] text-slate-500">Where: {s.where}</p>
                  {s.actAs && !s.done && me?.member.handle !== s.actAs && (
                    <button type="button" className="mt-2 rounded-md bg-brand-700 px-2 py-1 text-xs font-medium text-white hover:bg-brand-800" onClick={() => sw.mutate(s.actAs!)}>
                      Switch to {s.actAs}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <h3 className="mb-2 mt-6">Edge cases to show</h3>
      <ul className="space-y-2">
        {demo.data.extras.map((x) => (
          <li key={x.title} className="rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
            <p className="text-sm font-semibold text-slate-900">{x.title}</p>
            {x.instruction}
          </li>
        ))}
      </ul>
    </div>
  );
}
