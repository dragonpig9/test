import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import clsx from 'clsx';
import type { DisputeView } from '@commonhours/shared';
import { Button, Card, ErrorBox, Field, KV, Loading, PageHeader, StatusChip } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { Timeline } from '../../components/Timeline';
import { useAuth } from '../../lib/auth';
import { credits, duration, fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { addEvidence, proposeMutual, recuse, retrySelection, useDispute, vote } from './api';

export function DisputeDetailPage() {
  const { id } = useParams();
  const q = useDispute(id);
  const { me } = useAuth();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} title="Could not load dispute" />;
  if (!q.data || !me) return null;
  const d = q.data.dispute;
  const e = d.exchange;
  const party = e.myRole !== 'observer';
  return (
    <div>
      <Link to="/disputes" className="text-sm text-brand-700 hover:underline">
        ← Disputes
      </Link>
      <PageHeader
        title={`Dispute: ${e.deliverable}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip status={d.status} />
            {d.outcome && <StatusChip status={d.outcome} />}
            Stage {d.stage === 1 ? '1 — single attestor' : '2 — panel of three'} · opened by {d.openedBy.displayName} on {fmtDate(d.createdAt)} · condition: <strong>{d.condition.toLowerCase()}</strong>
          </span>
        }
      />
      {d.status === 'NEEDS_REVIEW' && <NeedsReview d={d} party={party} />}
      {d.status === 'RESOLVED' && (
        <div className={clsx('mb-6 rounded-2xl border p-4', d.outcome === 'CONFIRMED' ? 'border-emerald-300 bg-emerald-50' : 'border-red-200 bg-red-50')}>
          <p className="text-lg font-semibold">
            Final result: {d.outcome === 'CONFIRMED' ? 'Confirmed — the agreed activity occurred' : 'Refuted — the agreed activity did not occur'}
          </p>
          <p className="text-sm">Decided by {d.outcomeSource} on {fmtDate(d.resolvedAt)}.</p>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {d.myAssignment?.status === 'ASSIGNED' && <VotePanel d={d} />}
          <Card title="Original agreement">
            <KV
              items={[
                ['Provider', <MemberChip key="p" m={e.provider} />],
                ['Recipient', <MemberChip key="r" m={e.recipient} />],
                ['Deliverable', e.deliverable],
                ['Duration', duration(e.durationMinutes)],
                ['Scheduled', fmtDate(e.scheduledAt)],
                ['Punctuality', e.punctualityRequired ? 'Required condition' : 'Not a condition'],
                ['Credits', `${credits(e.creditAmount)}${e.giftBonus ? ` + ${credits(e.giftBonus)} gift` : ''}`],
                ['Terms version', `v${e.termsVersion}, accepted by both on ${fmtDate(e.acceptedAt)}`],
              ]}
            />
            <Link to={`/exchanges/${e.id}`} className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
              Open the exchange →
            </Link>
          </Card>
          <Card title="Evidence and statements">
            <ul className="space-y-3">
              {d.evidence.map((ev) => (
                <li key={ev.id} className={clsx('rounded-xl border p-3 text-sm', ev.author.id === e.provider.id ? 'border-sky-200 bg-sky-50/50' : 'border-amber-200 bg-amber-50/50')}>
                  <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                    <MemberChip m={ev.author} suffix={ev.author.id === e.provider.id ? 'provider' : 'recipient'} /> · {ev.kind.toLowerCase()} · {fmtDate(ev.createdAt)}
                  </div>
                  <p className="whitespace-pre-wrap text-slate-800">{ev.content}</p>
                </li>
              ))}
            </ul>
            {party && d.status !== 'RESOLVED' && <EvidenceForm id={d.id} />}
          </Card>
          <Card title="Attestor selection and eligibility">
            <p className="mb-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">{d.independenceNote}</p>
            {d.selections.map((s) => (
              <div key={s.id} className="mb-5">
                <p className="text-sm font-semibold">
                  Round {s.round} · needed {s.requiredCount} · {s.sufficient ? `selected ${s.selected.map((m) => m.displayName).join(', ')}` : 'not enough eligible members'}
                </p>
                <p className="font-mono text-[11px] text-slate-500">seed: {s.seed}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="py-1 pr-2">Member</th>
                        <th className="pr-2">Eligible</th>
                        <th className="pr-2">Hops to {e.provider.displayName.split(' ')[0]} / {e.recipient.displayName.split(' ')[0]}</th>
                        <th className="pr-2">Score</th>
                        <th>Why excluded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {s.candidates.map((c) => (
                        <tr key={c.member.id} className={c.eligible ? 'bg-emerald-50/40' : ''}>
                          <td className="py-1.5 pr-2 font-medium">
                            {c.member.displayName}
                            {s.selected.some((x) => x.id === c.member.id) && <span className="ml-1 rounded bg-brand-700 px-1 text-[10px] text-white">selected</span>}
                          </td>
                          <td className="pr-2">{c.eligible ? '✓ yes' : '✗ no'}</td>
                          <td className="pr-2 num">
                            {c.distanceToParties[e.provider.id] ?? '∞'} / {c.distanceToParties[e.recipient.id] ?? '∞'}
                          </td>
                          <td className="pr-2 num">{c.score}</td>
                          <td className="text-slate-600">{c.reasons.join('; ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </Card>
          <Card title="Votes">
            {d.assignments.length ? (
              <ul className="space-y-2 text-sm">
                {d.assignments.map((a) => (
                  <li key={a.id} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <MemberChip m={a.attestor} suffix={`round ${a.round}`} />
                      <StatusChip status={a.vote ?? a.status} label={a.vote ? `voted ${a.vote.toLowerCase()}` : a.status.toLowerCase().replace('_', ' ')} />
                    </div>
                    {a.reason && <p className="mt-1 text-slate-700">“{a.reason}”</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">No attestors assigned.</p>
            )}
            <p className="mt-3 text-xs text-slate-500">Nobody is penalised for disagreeing with the majority. Any misconduct penalty needs a documented finding.</p>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Credit and credibility effects">
            <ul className="space-y-2 text-sm">
              {d.effects.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden>{x.kind === 'credits' ? '◷' : '★'}</span>
                  <span>{x.description}</span>
                </li>
              ))}
            </ul>
            {d.voteDeadline && <p className="mt-3 text-xs text-slate-500">Votes due by {fmtDate(d.voteDeadline)}.</p>}
          </Card>
          {party && d.status !== 'RESOLVED' && <MutualPanel d={d} />}
          <Card title="Dispute timeline">
            <Timeline entries={d.timeline} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function NeedsReview({ d, party }: { d: DisputeView; party: boolean }) {
  const retry = useAction(() => retrySelection(d.id));
  return (
    <div className="mb-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950" role="alert">
      <p className="text-base font-semibold">Needs review — credits stay frozen</p>
      <p className="mt-1">
        <strong>Blocker:</strong> {d.reviewReason}
      </p>
      <p className="mt-1">
        <strong>Next action:</strong> {d.nextAction}
      </p>
      {party && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" busy={retry.isPending} onClick={() => retry.mutate(undefined)}>
            Retry attestor selection
          </Button>
        </div>
      )}
      <div className="mt-2">
        <ErrorBox error={retry.error} />
      </div>
    </div>
  );
}

function VotePanel({ d }: { d: DisputeView }) {
  const [choice, setChoice] = useState<'CONFIRMED' | 'REFUTED' | 'UNCLEAR'>('CONFIRMED');
  const [reason, setReason] = useState('');
  const cast = useAction(() => vote(d.id, choice, reason));
  const rec = useAction(() => recuse(d.id, reason || 'Conflict of interest'));
  return (
    <Card title="Your attestation vote" className="border-violet-300 ring-2 ring-violet-200">
      <p className="text-sm text-slate-700">
        Question: <strong>did the pre-agreed activity happen as agreed?</strong> Judge only against the original agreement{d.exchange.punctualityRequired ? ' (punctuality WAS an agreed condition)' : ' (punctuality was NOT an agreed condition)'}.
      </p>
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); cast.mutate(undefined); }}>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ['CONFIRMED', 'Confirmed', 'It happened as agreed → credits settle'],
              ['REFUTED', 'Refuted', 'It did not happen as agreed → reservation released'],
              ['UNCLEAR', 'Unclear', d.stage === 1 ? 'Escalate to a panel of three' : 'Counts as no decision'],
            ] as const
          ).map(([v, l, hint]) => (
            <label key={v} className={clsx('cursor-pointer rounded-xl border p-3 text-sm', choice === v ? 'border-violet-500 bg-violet-50' : 'border-slate-200')}>
              <input type="radio" className="sr-only" checked={choice === v} onChange={() => setChoice(v)} />
              <span className="font-semibold">{l}</span>
              <span className="block text-xs text-slate-600">{hint}</span>
            </label>
          ))}
        </div>
        <Field label="Your reasoning (required, recorded)" htmlFor="vr">
          <textarea id="vr" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} />
        </Field>
        <ErrorBox error={cast.error ?? rec.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={cast.isPending}>
            Submit vote
          </Button>
          <Button type="button" variant="secondary" busy={rec.isPending} onClick={() => window.confirm('Recuse yourself because of a conflict of interest? A replacement will be drawn.') && rec.mutate(undefined)}>
            Recuse (conflict)
          </Button>
        </div>
      </form>
    </Card>
  );
}

function EvidenceForm({ id }: { id: string }) {
  const [content, setContent] = useState('');
  const save = useAction(() => addEvidence(id, 'STATEMENT', content), () => setContent(''));
  return (
    <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <Field label="Add a statement or evidence" htmlFor="ev">
        <textarea id="ev" className="input" rows={2} value={content} onChange={(e) => setContent(e.target.value)} required minLength={3} />
      </Field>
      <ErrorBox error={save.error} />
      <Button type="submit" variant="secondary" busy={save.isPending}>
        Add statement
      </Button>
    </form>
  );
}

function MutualPanel({ d }: { d: DisputeView }) {
  const { me } = useAuth();
  const m = useAction((o: 'CONFIRMED' | 'REFUTED') => proposeMutual(d.id, o));
  const mine = d.mutualProposal?.byId === me?.member.id;
  return (
    <Card title="Resolve by agreement">
      <p className="text-sm text-slate-600">Both parties can settle the dispute themselves at any time. A mutual outcome applies no credibility penalty.</p>
      {d.mutualProposal && (
        <p className="mt-2 rounded-lg bg-sky-50 p-2 text-sm">
          {mine ? 'You proposed' : 'The other party proposed'}: <strong>{d.mutualProposal.outcome.toLowerCase()}</strong>
          {!mine && ' — choose the same option to agree.'}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" busy={m.isPending && m.variables === 'CONFIRMED'} onClick={() => m.mutate('CONFIRMED')}>
          Agree it happened (pay)
        </Button>
        <Button variant="secondary" busy={m.isPending && m.variables === 'REFUTED'} onClick={() => m.mutate('REFUTED')}>
          Agree it didn’t (release)
        </Button>
      </div>
      <div className="mt-2">
        <ErrorBox error={m.error} />
      </div>
    </Card>
  );
}
