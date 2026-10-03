import clsx from 'clsx';
import type { DemoWalkthroughView, DisputeView } from '@commonhours/shared';
import { MemberChip } from '../../../components/MemberChip';
import { Button, ErrorBox, Loading, StatusChip } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { credits, fmtDate } from '../../../lib/format';
import { JurySelection, NeedsReview, VotePanel } from '../../disputes/DisputeDetailPage';
import { OpenDisputeForm } from '../../disputes/OpenDisputeForm';
import { useDispute } from '../../disputes/api';
import { useExchange } from '../../exchanges/api';
import { ActAsButton, ActingBanner, ClockControl, Details, Step, useActAs } from './parts';

/** Chapter 4 (Demo Guide steps 10–12): Sam disputes the agreed punctuality condition; selected jurors vote. */
export function Chapter4Dispute({ w }: { w: DemoWalkthroughView }) {
  const { me } = useActAs();
  const { translation, disputeId } = w.story;
  const sam = w.members.sam;
  if (!translation) {
    return (
      <Step title="Sam’s punctuality complaint" state="waiting">
        <p className="text-sm text-slate-600">The dispute is about the translation exchange from chapter 3, which hasn’t been requested yet.</p>
      </Step>
    );
  }
  const due = new Date(translation.scheduledAt) <= new Date(w.now);
  return (
    <div className="space-y-4">
      <Step title="The original agreement" state="info">
        <p className="text-sm">
          {translation.deliverable} · {translation.provider.displayName} provides, {translation.recipient.displayName} pays {credits(translation.creditAmount)} cr · scheduled {fmtDate(translation.scheduledAt)}
        </p>
        <p className={clsx('mt-2 rounded-lg p-2 text-sm', translation.punctualityRequired ? 'bg-brand-50 text-brand-900' : 'bg-amber-50 text-amber-900')}>
          Punctuality {translation.punctualityRequired ? <strong>was agreed as a condition</strong> : <strong>was not agreed</strong>}, so a lateness complaint {translation.punctualityRequired ? 'can' : 'cannot'} be judged. Jurors decide only against these agreed terms.
        </p>
      </Step>
      {!disputeId ? (
        <Step title="Sam opens a dispute" state={translation.status === 'ACCEPTED' && due ? 'ready' : 'waiting'}>
          {translation.status === 'PROPOSED' ? (
            <p className="text-sm text-slate-600">Waiting for Mei to accept the translation (chapter 3). Only accepted exchanges can be disputed.</p>
          ) : translation.status !== 'ACCEPTED' ? (
            <p className="text-sm text-slate-600">This exchange is {translation.status.toLowerCase()}, so it can no longer be disputed. Disputes must be opened before settlement.</p>
          ) : !due ? (
            <ClockControl why={`A dispute can only be opened after the service time (${fmtDate(translation.scheduledAt)}); the clock now reads ${fmtDate(w.now)}.`} />
          ) : me?.handle === 'sam' ? (
            <OpenDispute id={translation.id} />
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              Sam says Mei was late. <ActAsButton m={sam} why="to open the dispute" />
            </div>
          )}
        </Step>
      ) : (
        <DisputeSection id={disputeId} />
      )}
    </div>
  );
}

function OpenDispute({ id }: { id: string }) {
  const q = useExchange(id);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  return <OpenDisputeForm exchange={q.data.exchange} onDone={() => undefined} />;
}

function DisputeSection({ id }: { id: string }) {
  const q = useDispute(id);
  const { me } = useAuth();
  if (q.isLoading) return <Loading label="Loading the dispute…" />;
  if (q.error || !q.data) {
    return (
      <div className="space-y-2">
        <ErrorBox error={q.error} title="Could not load the dispute" />
        <Button variant="secondary" onClick={() => void q.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  const d = q.data.dispute;
  const r = d.exchange.reservation;
  const latest = d.selections[d.selections.length - 1];
  const pending = d.assignments.filter((a) => a.status === 'ASSIGNED');
  const mine = d.myAssignment?.status === 'ASSIGNED' ? d.myAssignment : null;
  return (
    <>
      <Step title="Sam’s complaint and the frozen credits" state="done">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm">
            <p className="text-xs text-slate-500">
              {d.openedBy.displayName} · condition: <strong>{d.condition.toLowerCase()}</strong> · {fmtDate(d.createdAt)}
            </p>
            <p className="mt-1">“{d.claim}”</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="text-xs text-slate-500">Reservation</p>
            {r ? (
              <p className="mt-1">
                <StatusChip status={r.status} /> <strong className="num">{credits(r.total)}</strong> cr from {d.exchange.recipient.displayName}
              </p>
            ) : (
              <p>—</p>
            )}
            <p className="mt-1 text-xs text-slate-600">{r?.status === 'FROZEN' ? 'Frozen: nobody is paid until there is an outcome. Opening a dispute changes nobody’s credibility.' : (r?.resolutionNote ?? '')}</p>
          </div>
        </div>
      </Step>

      <Step title="Who judges it" state="info" note="Jurors are drawn from eligible members with the fewest connections to either party.">
        {latest ? (
          <div className="space-y-2 text-sm">
            <p>
              Round {latest.round}: <strong>{latest.candidates.filter((c) => c.eligible).length}</strong> eligible of {latest.candidates.length} members · needed {latest.requiredCount} ·{' '}
              {latest.sufficient ? (
                <>
                  selected <strong>{latest.selected.map((m) => m.displayName).join(', ')}</strong>
                </>
              ) : (
                <strong className="text-red-800">not enough eligible members</strong>
              )}
            </p>
            <p className="text-xs text-slate-600">
              Low-closeness selection: each eligible member’s closeness is their strongest relationship trust to either party; the lowest is chosen (ties broken by a recorded seed). Credibility is only a minimum, never a ranking.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No selection recorded yet.</p>
        )}
        <div className="mt-3">
          <Details title="Details: full candidate and exclusion table">
            <JurySelection d={d} />
          </Details>
        </div>
      </Step>

      <Step title="Voting and result" state={d.status === 'RESOLVED' ? 'done' : d.status === 'NEEDS_REVIEW' ? 'blocked' : 'ready'}>
        <Votes d={d} />
        {d.status === 'NEEDS_REVIEW' && <NeedsReview d={d} party={d.exchange.myRole !== 'observer'} />}
        {d.status === 'RESOLVED' && (
          <div className={clsx('rounded-xl border p-3', d.outcome === 'CONFIRMED' ? 'border-emerald-300 bg-emerald-50' : 'border-red-200 bg-red-50')}>
            <p className="font-semibold">Result: {d.outcome === 'CONFIRMED' ? 'Confirmed — the agreed activity happened as agreed' : 'Refuted — it did not happen as agreed'}</p>
            <p className="text-sm">
              Decided by {d.outcomeSource} on {fmtDate(d.resolvedAt)}. {d.effects.map((x) => x.description).join(' ')}
            </p>
          </div>
        )}
        {pending.length > 0 && (
          <div className="mt-3 space-y-3">
            {mine && me ? (
              <>
                <ActingBanner m={me.member} doing="the vote and reason you submit are recorded under this juror’s name. Pick whichever outcome you think the agreement supports." />
                <VotePanel d={d} />
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                Waiting for {pending.map((a) => a.attestor.displayName).join(', ')} to vote.
                {pending.map((a) => (
                  <ActAsButton key={a.id} m={a.attestor} why="selected juror" />
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500">
              Stage {d.stage === 1 ? '1: one juror. “Unclear” escalates to a panel of three.' : '2: a panel of three; two matching votes decide.'} Votes due {fmtDate(d.voteDeadline)}.
            </p>
          </div>
        )}
      </Step>
    </>
  );
}

function Votes({ d }: { d: DisputeView }) {
  const voted = d.assignments.filter((a) => a.vote);
  if (!voted.length) return <p className="mb-2 text-sm text-slate-600">No votes recorded yet.</p>;
  return (
    <ul className="mb-3 space-y-1.5 text-sm">
      {voted.map((a) => (
        <li key={a.id} className="rounded-lg border border-slate-200 p-2">
          <span className="flex flex-wrap items-center gap-2">
            <MemberChip m={a.attestor} suffix={`round ${a.round}`} /> <StatusChip status={a.vote!} label={`voted ${a.vote!.toLowerCase()}`} />
          </span>
          {a.reason && <span className="mt-1 block text-xs text-slate-600">“{a.reason}”</span>}
        </li>
      ))}
    </ul>
  );
}
