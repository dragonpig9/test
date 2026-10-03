import clsx from 'clsx';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { DemoWalkthroughView } from '@commonhours/shared';
import { Avatar } from '../../../components/MemberChip';
import { Button, ErrorBox, Loading } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { fmtDate } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';
import { usePublicConfig } from '../../auth/api';
import { switchAccount } from '../api';
import { CHAPTERS, useWalkthrough } from './api';
import { Chapter1Trust } from './Chapter1Trust';
import { Chapter2Exchanges } from './Chapter2Exchanges';
import { Chapter3Pricing } from './Chapter3Pricing';
import { Chapter4Dispute } from './Chapter4Dispute';
import { Chapter5Results } from './Chapter5Results';
import { EdgeCases } from './EdgeCases';
import { ActAsButton, ClockNote, useActAs } from './parts';

const INTRO: Record<number, string> = {
  1: 'Mei needs dinner and Sam cooks. Before anyone agrees anything, CommonHours shows how they are connected and what each trust signal means.',
  2: 'Mei and Sam agree two separate exchanges. Credits are reserved when both accept and move only when both confirm the work happened.',
  3: 'Some skills earn more per hour, but only through published rules: a peer-reviewed tier and measured demand, locked when both accept.',
  4: 'Sam says Mei was late. Because punctuality was agreed, jurors with few ties to either of them judge it against the terms.',
  5: 'Everything that changed, read back from the records.',
};
/** Who usually acts in each chapter (one click to switch; nobody is switched automatically). */
const CAST: Record<number, string[]> = { 1: ['mei'], 2: ['mei', 'sam'], 3: ['sam', 'mei'], 4: ['sam', 'mei'], 5: ['mei'] };

/**
 * The Simple demo: the 15-step Demo Guide as five chapters with the real actions embedded.
 * A presentation layer only: it reads /api/demo/walkthrough and acts through the ordinary API as the
 * acting member. Back/Next only change which chapter is shown; progress comes from backend records.
 */
export function DemoWalkthroughPage() {
  const cfg = usePublicConfig();
  const { signedIn, loading, signIn } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get('chapter');
  const view: number | 'edge' = raw === 'edge' ? 'edge' : Math.min(5, Math.max(1, Number(raw) || 1));
  // Switching members resets every query; remember the server's demo flag so the page never unmounts mid-chapter.
  const demoFlag = useRef<boolean | undefined>(undefined);
  if (cfg.data) demoFlag.current = cfg.data.demoMode;
  const demoOn = !!demoFlag.current;

  // No registration, mailbox or invitation: start visitors as Mei through the existing demo switcher.
  // Also covers a stale token after the demo data was re-seeded (at most twice, so a failure never loops).
  const start = useAction((h: string) => switchAccount(h), (r) => signIn(r.token));
  const attempts = useRef(0);
  useEffect(() => {
    if (demoOn && !loading && !signedIn && !start.isPending && !start.isError && attempts.current < 2) {
      attempts.current += 1;
      start.mutate('mei');
    }
  }, [demoOn, loading, signedIn, start]);

  const wq = useWalkthrough(demoOn);
  // Keep showing the last state while queries refetch after a participant switch.
  const last = useRef<DemoWalkthroughView>();
  if (wq.data) last.current = wq.data;
  const w = wq.data ?? last.current;

  // Block body: newer Chrome returns a Promise from scrollTo, which React would call as the cleanup.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);
  const go = (v: number | 'edge') => setParams(v === 1 ? {} : { chapter: String(v) });

  if (demoFlag.current === undefined && cfg.isLoading) return <Loading label="Opening the demo…" />;
  if (!demoOn) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1>Simple demo</h1>
          <p className="mt-2 text-sm text-slate-600">{cfg.error ? 'The demo server could not be reached.' : 'The guided demo is only available when this server runs in demo mode.'}</p>
          <Link to="/" className="mt-4 inline-block font-medium text-brand-700 hover:underline">
            Open full app →
          </Link>
        </div>
      </Shell>
    );
  }
  return (
    <Shell w={w}>
      <p className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <strong>Hackathon demo — example members and exchanges.</strong>{' '}
        <span className="text-amber-900">This is one shared demo community: other visitors may already have moved the story on, and you will see their saved results. Opening or restarting the walkthrough never resets data.</span>
      </p>
      <Progress view={view} w={w} onGo={go} />
      {start.error && !signedIn ? (
        <Retry error={start.error} onRetry={() => start.mutate('mei')} title="Could not start the demo as Mei" />
      ) : !w ? (
        wq.error ? <Retry error={wq.error} onRetry={() => void wq.refetch()} title="Could not load the demo" /> : <Loading label="Loading the demo community…" />
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <main id="main" className="min-w-0 space-y-4">
            <ClockNote />
            {view === 'edge' ? (
              <>
                <h1>Explore edge cases</h1>
                <EdgeCases w={w} />
              </>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Chapter {view} of 5</p>
                  <h1>{CHAPTERS[view - 1].title}</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-600">{INTRO[view]}</p>
                </div>
                {view === 1 && <Chapter1Trust w={w} />}
                {view === 2 && <Chapter2Exchanges w={w} />}
                {view === 3 && <Chapter3Pricing w={w} />}
                {view === 4 && <Chapter4Dispute w={w} />}
                {view === 5 && <Chapter5Results w={w} />}
              </>
            )}
            {wq.error && <Retry error={wq.error} onRetry={() => void wq.refetch()} title="Could not refresh the latest state" />}
            <nav className="flex items-center justify-between gap-2 border-t border-slate-200 pt-4" aria-label="Walkthrough navigation">
              <Button variant="secondary" disabled={view === 1} onClick={() => go(view === 'edge' ? 5 : view - 1)}>
                ← Back
              </Button>
              {view === 'edge' ? (
                <Button variant="secondary" onClick={() => go(1)}>
                  Restart walkthrough
                </Button>
              ) : view < 5 ? (
                <Button onClick={() => go(view + 1)}>Next: {CHAPTERS[view].short} →</Button>
              ) : (
                <Button variant="secondary" onClick={() => go('edge')}>
                  Explore edge cases →
                </Button>
              )}
            </nav>
          </main>
          <aside className="space-y-4" aria-label="Demo participant and progress">
            <Participant w={w} cast={view === 'edge' ? ['mei', 'alice', 'ben'] : CAST[view]} />
            {view !== 'edge' && <ChapterSteps w={w} n={view} />}
            <p className="px-1 text-xs text-slate-500">
              Simulated clock: <span className="num">{fmtDate(w.now)}</span>. It only moves when someone presses an explicit clock button.
            </p>
          </aside>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, w }: { children: ReactNode; w?: DemoWalkthroughView }) {
  const [, setParams] = useSearchParams();
  const { me } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-white" aria-hidden>
            ◷
          </span>
          <span className="font-semibold tracking-tight">CommonHours</span>
          <span className="rounded-md bg-amber-200 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-950">Simple demo</span>
          {me && w && (
            <span className="flex items-center gap-1.5 text-sm text-slate-700" aria-live="polite">
              <Avatar m={me.member} size="sm" /> Acting as <strong>{me.member.displayName}</strong>
            </span>
          )}
          <span className="ml-auto flex items-center gap-3 text-sm">
            {w && (
              <button type="button" className="font-medium text-slate-600 hover:text-slate-900" onClick={() => setParams({})}>
                Restart walkthrough
              </button>
            )}
            <Link to="/" className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50">
              Open full app
            </Link>
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">{children}</div>
    </div>
  );
}

function Progress({ view, w, onGo }: { view: number | 'edge'; w?: DemoWalkthroughView; onGo: (v: number | 'edge') => void }) {
  return (
    <nav aria-label="Chapters" className="overflow-x-auto">
      <ol className="flex min-w-max gap-1.5 sm:min-w-0">
        {CHAPTERS.map((c) => {
          const done = w?.chapters.find((x) => x.n === c.n)?.done;
          const current = view === c.n;
          return (
            <li key={c.n} className="flex-1">
              <button
                type="button"
                aria-current={current ? 'step' : undefined}
                onClick={() => onGo(c.n)}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm',
                  current ? 'border-brand-600 bg-brand-50 font-semibold text-brand-900' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300',
                )}
              >
                <span
                  className={clsx('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', done ? 'bg-brand-600 text-white' : current ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-700')}
                  aria-label={done ? 'completed in the records' : undefined}
                >
                  {done ? '✓' : c.n}
                </span>
                <span className="truncate">{c.short}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            aria-current={view === 'edge' ? 'step' : undefined}
            onClick={() => onGo('edge')}
            className={clsx('h-full whitespace-nowrap rounded-xl border border-dashed px-2.5 py-2 text-sm', view === 'edge' ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-slate-300 bg-white text-slate-600 hover:border-brand-300')}
          >
            Explore edge cases
          </button>
        </li>
      </ol>
    </nav>
  );
}

function Participant({ w, cast }: { w: DemoWalkthroughView; cast: string[] }) {
  const { me, switchTo, pending, error } = useActAs();
  const others = Object.values(w.members).filter((m) => !cast.includes(m.handle));
  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Demo participant</p>
      {me ? (
        <p className="mt-2 flex items-center gap-2 font-semibold text-slate-900">
          <Avatar m={me} /> {me.displayName}
        </p>
      ) : (
        <Loading label="Signing in…" />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {cast.map((h) => w.members[h] && <ActAsButton key={h} m={w.members[h]} />)}
      </div>
      <label className="mt-3 block text-xs text-slate-600">
        Another member
        <select className="input mt-1 !py-1.5" value="" disabled={!!pending} onChange={(e) => e.target.value && switchTo(e.target.value)}>
          <option value="">Choose…</option>
          {others.map((m) => (
            <option key={m.id} value={m.handle}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-2 text-[11px] text-slate-500">Switching uses the demo account switcher. Actions run as this member with their normal permissions.</p>
      {error && <ErrorBox error={error} title="Could not switch member" />}
    </section>
  );
}

function ChapterSteps({ w, n }: { w: DemoWalkthroughView; n: number }) {
  const c = w.chapters.find((x) => x.n === n);
  if (!c) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Demo Guide steps {c.steps[0]?.n}–{c.steps[c.steps.length - 1]?.n}</p>
      <ol className="mt-2 space-y-1.5 text-sm">
        {c.steps.map((s) => (
          <li key={s.n} className="flex gap-2">
            <span className={clsx('mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', s.done ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-700')}>{s.done ? '✓' : s.n}</span>
            <span className={s.done ? 'text-slate-500' : 'text-slate-800'}>{s.title}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-slate-500">Ticks come from saved records, not from clicking Next.</p>
    </section>
  );
}

function Retry({ error, onRetry, title }: { error: unknown; onRetry: () => void; title: string }) {
  return (
    <div className="mt-4 space-y-2">
      <ErrorBox error={error} title={title} />
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
