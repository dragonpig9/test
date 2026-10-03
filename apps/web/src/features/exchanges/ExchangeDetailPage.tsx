import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ServiceCategory } from '@commonhours/shared';
import { Button, Card, ErrorBox, KV, Loading, Modal, PageHeader, StatusChip, Why } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { Timeline } from '../../components/Timeline';
import { credits, duration, fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { OpenDisputeForm } from '../disputes/OpenDisputeForm';
import { PriceBreakdown } from '../pricing/PriceBreakdown';
import { EligibilityPanel, TierBadge } from '../task-eligibility/EligibilityPanel';
import { TrustUpdateCard } from '../trust-graph/TrustUpdateCard';
import { proposePartial, useExchange } from './api';
import { ACTION_LABEL, useExchangeAction } from './ExchangeActions';
import { TermsForm } from './TermsForm';

const LABEL = ACTION_LABEL;

export function ExchangeDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const q = useExchange(id);
  const [modal, setModal] = useState<'edit' | 'dispute' | 'partial' | 'reciprocal' | null>(null);
  const [partial, setPartial] = useState({ amount: 0.5, note: '' });
  const act = useExchangeAction(q.data?.exchange);
  const doPartial = useAction(() => proposePartial(q.data!.exchange.id, Math.round(partial.amount * 100), partial.note), () => setModal(null));
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} title="Could not load this exchange" />;
  if (!q.data) return null;
  const { exchange: e, trustPath, timeline, liabilitySnapshot, eligibility, trustUpdate, homeAddress } = q.data;
  const counterpart = e.myRole === 'provider' ? e.recipient : e.provider;
  const r = e.reservation;
  return (
    <div>
      <Link to="/exchanges" className="text-sm text-brand-700 hover:underline">
        ← My exchanges
      </Link>
      <PageHeader
        title={e.deliverable}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip status={e.status} /> <TierBadge tier={e.trustTier} /> {e.category} · terms version {e.termsVersion} · you are the <strong>{e.myRole}</strong>
          </span>
        }
      />
      {e.cancelRequestedById && e.status === 'ACCEPTED' && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
          {e.cancelRequestedById === counterpart.id ? `${counterpart.displayName} asked to cancel after the free window. Use “Cancel exchange” to agree.` : 'You asked to cancel after the free window; waiting for the other member to agree.'}
        </div>
      )}
      {e.partialProposedById && e.status === 'ACCEPTED' && (
        <div className="mb-4 rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm">
          Partial completion proposed by {e.partialProposedById === e.provider.id ? e.provider.displayName : e.recipient.displayName}: pay {credits(e.partialAmount)} of {credits(e.creditAmount + e.giftBonus)} — “{e.partialNote}”. The rest would be released.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Actions">
            <div className="flex flex-wrap gap-2">
              {e.actions.map((a) =>
                a.key === 'editTerms' ? (
                  <Button key={a.key} variant="secondary" onClick={() => setModal('edit')}>
                    {LABEL[a.key]}
                  </Button>
                ) : a.key === 'dispute' ? (
                  <Button key={a.key} variant="danger" disabled={!a.allowed} title={a.reason ?? undefined} onClick={() => setModal('dispute')}>
                    {LABEL[a.key]}
                  </Button>
                ) : a.key === 'proposePartial' ? (
                  <Button key={a.key} variant="secondary" disabled={!a.allowed} title={a.reason ?? undefined} onClick={() => setModal('partial')}>
                    {LABEL[a.key]}
                  </Button>
                ) : (
                  <Button key={a.key} variant={['decline', 'withdraw', 'cancel'].includes(a.key) ? 'secondary' : 'primary'} disabled={!a.allowed} title={a.reason ?? undefined} busy={act.isPending && act.variables === a.key} onClick={() => act.mutate(a.key)}>
                    {LABEL[a.key] ?? a.key}
                  </Button>
                ),
              )}
              {e.myRole !== 'observer' && !e.linkedExchangeId && ['PROPOSED', 'ACCEPTED', 'SETTLED'].includes(e.status) && (
                <Button variant="ghost" onClick={() => setModal('reciprocal')}>
                  Propose reciprocal exchange
                </Button>
              )}
              {e.linkedExchangeId && (
                <Link to={`/exchanges/${e.linkedExchangeId}`} className="self-center text-sm font-medium text-teal-700 hover:underline">
                  Open linked exchange →
                </Link>
              )}
              {e.disputeId && (
                <Link to={`/disputes/${e.disputeId}`} className="self-center text-sm font-medium text-amber-800 hover:underline">
                  View dispute →
                </Link>
              )}
            </div>
            {e.actions.filter((a) => a.reason).length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {e.actions
                  .filter((a) => a.reason)
                  .map((a) => (
                    <li key={a.key}>
                      <strong>{LABEL[a.key] ?? a.key}:</strong> {a.reason}
                    </li>
                  ))}
              </ul>
            )}
            <div className="mt-3">
              <ErrorBox error={act.error} />
            </div>
          </Card>
          <Card title="Agreed terms">
            <KV
              items={[
                ['Provider', <MemberChip key="p" m={e.provider} />],
                ['Recipient (pays)', <MemberChip key="r" m={e.recipient} />],
                ['Deliverable', e.deliverable],
                ['Duration', duration(e.durationMinutes)],
                ['Scheduled', fmtDate(e.scheduledAt)],
                ['Location', e.location || '—'],
                ['Punctuality', e.punctualityRequired ? 'Required condition (lateness can be disputed)' : 'Not a condition (lateness alone cannot be disputed)'],
                ['Service credits', `${credits(e.creditAmount)} (${e.pricing?.legacy ? '1 hour = 1 credit' : 'hours × skill × demand — see Price'})`],
                ['Gift bonus', e.giftBonus ? `${credits(e.giftBonus)} — voluntary, from ${e.recipient.displayName}` : 'None'],
                ['Access level', `${e.trustTier.replace('_', ' ').toLowerCase()}${e.homeAccess.required ? ` · home access ${e.homeAccess.approved ? `approved ${fmtDate(e.homeAccess.approvedAt)}` : 'not yet approved by the owner'}` : ''}`],
                ...(e.minCredibility !== null || e.minRelationshipTrust !== null || e.maxCreditBudget !== null
                  ? ([['Requester’s requirements', [e.minCredibility !== null && `credibility ≥ ${e.minCredibility}`, e.minRelationshipTrust !== null && `relationship trust ≥ ${e.minRelationshipTrust}`, e.maxCreditBudget !== null && `budget ≤ ${credits(e.maxCreditBudget)} credits`].filter(Boolean).join(' · ')]] as [string, string][])
                  : []),
                ['Cancellation', `Free until ${e.cancellationNoticeHours}h before; later only by mutual agreement. ${e.cancellationTerms}`],
                ['Confirm completion by', fmtDate(e.confirmationDeadline)],
                ['Acceptance', `${e.provider.displayName}: ${e.providerAcceptedAt ? fmtDate(e.providerAcceptedAt) : 'not yet'} · ${e.recipient.displayName}: ${e.recipientAcceptedAt ? fmtDate(e.recipientAcceptedAt) : 'not yet'}`],
                ['Completion confirmed', `${e.provider.displayName}: ${e.providerConfirmedAt ? fmtDate(e.providerConfirmedAt) : '—'} · ${e.recipient.displayName}: ${e.recipientConfirmedAt ? fmtDate(e.recipientConfirmedAt) : '—'}`],
              ]}
            />
            <p className="mt-3 text-xs text-slate-500">After both accept, the terms and price are locked. No surprise changes.</p>
          </Card>
          {e.pricing && (
            <Card title={e.priceLocked ? 'Price (locked at acceptance)' : 'Price breakdown (quote for this terms version)'}>
              <PriceBreakdown price={e.pricing} />
            </Card>
          )}
          {eligibility && (
            <Card title={e.status === 'PROPOSED' ? 'Task eligibility' : 'Task eligibility (recorded at acceptance)'}>
              <EligibilityPanel e={eligibility} perspective={e.myRole === 'provider' ? 'provider' : 'owner'} />
            </Card>
          )}
          {trustUpdate && <TrustUpdateCard u={trustUpdate} />}
          <Card title="Progress timeline">
            <Timeline entries={timeline} />
          </Card>
        </div>
        <div className="space-y-6">
          {homeAddress && (
            <Card title="Home address (private)">
              <p className="text-sm font-medium">{homeAddress}</p>
              <p className="mt-1 text-xs text-slate-500">Shown only to you, the provider of this accepted in-home exchange. It disappears once the exchange is closed and is never sent by email.</p>
            </Card>
          )}
          <Card title={e.myRole === 'provider' ? 'Recipient' : e.myRole === 'recipient' ? 'Provider' : 'Members'}>
            <MemberChip m={counterpart} detail />
            <Link to={`/profile/${counterpart.id}`} className="mt-2 block text-sm font-medium text-brand-700 hover:underline">
              View profile →
            </Link>
          </Card>
          <Card title="Credit reservation">
            {r ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <StatusChip status={r.status} />
                  <span className="text-2xl font-semibold num">{credits(r.total)}</span>
                </div>
                <p>
                  {credits(r.amount)} standard{r.giftBonus ? ` + ${credits(r.giftBonus)} gift` : ''}, from {e.recipient.displayName} to {e.provider.displayName}.
                </p>
                <p className="text-xs text-slate-600">
                  {r.status === 'ACTIVE' && 'Reserved: reduces the recipient’s available balance but nobody has been paid yet.'}
                  {r.status === 'FROZEN' && 'Frozen by a dispute: still reserved, cannot be spent or paid until a final outcome.'}
                  {r.status === 'SETTLED' && (r.resolutionNote ?? 'Paid.')}
                  {r.status === 'RELEASED' && (r.resolutionNote ?? 'Released without payment.')}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No credits are reserved until both members accept the same terms.</p>
            )}
          </Card>
          <Card title="Trust path">
            {trustPath.found ? (
              <div className="text-sm">
                <p className="font-semibold text-teal-700">
                  {trustPath.members.map((m) => m.displayName).join(' → ')}
                </p>
                <p className="mt-1 font-mono text-xs">{trustPath.calculation}</p>
                <Why>{trustPath.explanation}</Why>
              </div>
            ) : (
              <p className="text-sm text-amber-800">{trustPath.explanation}</p>
            )}
          </Card>
          <Card title="Accountability">
            {liabilitySnapshot?.length ? (
              <ul className="space-y-1 text-sm">
                {liabilitySnapshot.map((s) => (
                  <li key={s.vouchId}>
                    Vouch for {s.voucheeId === e.provider.id ? e.provider.displayName : e.recipient.displayName}: strength {s.strength}, liability {s.liabilityPct}%
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">Captured when the exchange is accepted.</p>
            )}
            <p className="mt-2 text-xs text-slate-500">Direct vouches active at acceptance stay accountable for this exchange even if revoked later. No cascade beyond direct vouchers.</p>
          </Card>
        </div>
      </div>
      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Change terms (creates a new version)" wide>
        <TermsForm
          mode="edit"
          exchangeId={e.id}
          providerId={e.provider.id}
          myRole={e.myRole === 'provider' ? 'provider' : 'recipient'}
          counterpartyName={counterpart.displayName}
          init={{ ...e, category: e.category as ServiceCategory, confirmationDays: 3 }}
          onDone={() => setModal(null)}
        />
      </Modal>
      <Modal open={modal === 'reciprocal'} onClose={() => setModal(null)} title={`Reciprocal exchange with ${counterpart.displayName}`} wide>
        <TermsForm
          mode="propose"
          myRole={e.myRole === 'provider' ? 'recipient' : 'provider'}
          counterpartyId={counterpart.id}
          counterpartyName={counterpart.displayName}
          linkedExchangeId={e.id}
          providerId={e.myRole === 'provider' ? counterpart.id : e.myRole === 'recipient' ? e.recipient.id : undefined}
          init={{ deliverable: '', category: 'Tutoring', durationMinutes: 60, location: '', punctualityRequired: false, giftBonus: 0, cancellationNoticeHours: 1, cancellationTerms: '', confirmationDays: 3 }}
          onDone={(nid) => {
            setModal(null);
            nav(`/exchanges/${nid}`);
          }}
        />
      </Modal>
      <Modal open={modal === 'dispute'} onClose={() => setModal(null)} title="Open a dispute" wide>
        <OpenDisputeForm exchange={e} onDone={(did) => nav(`/disputes/${did}`)} />
      </Modal>
      <Modal open={modal === 'partial'} onClose={() => setModal(null)} title="Propose partial completion">
        <form className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); doPartial.mutate(undefined); }}>
          <p className="text-sm text-slate-600">Propose paying part of the agreed {credits(e.creditAmount + e.giftBonus)}. If {counterpart.displayName} accepts, that amount settles and the rest is released.</p>
          <label className="block text-sm">
            <span className="label">Credits to pay</span>
            <input className="input" type="number" step={0.25} min={0.25} max={(e.creditAmount + e.giftBonus) / 100 - 0.25} value={partial.amount} onChange={(ev) => setPartial({ ...partial, amount: Number(ev.target.value) })} />
          </label>
          <label className="block text-sm">
            <span className="label">What was and wasn’t done</span>
            <textarea className="input" rows={2} value={partial.note} onChange={(ev) => setPartial({ ...partial, note: ev.target.value })} required minLength={3} />
          </label>
          <ErrorBox error={doPartial.error} />
          <Button type="submit" busy={doPartial.isPending}>
            Send proposal
          </Button>
        </form>
      </Modal>
    </div>
  );
}
