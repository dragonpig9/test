import type { DemoComparisonRow, DemoWalkthroughView } from '@commonhours/shared';
import { credits, duration, fmtDate } from '../../../lib/format';
import { TermsForm } from '../../exchanges/TermsForm';
import { ActAsButton, ClockControl, Details, ExchangePanel, Step, useActAs } from './parts';

const LEDGER_KIND: Record<string, string> = { POOL_DISTRIBUTION: 'Community Credit Pool reward', EXPIRY: 'Credit expiry', ADJUSTMENT: 'Adjustment', SETTLEMENT: 'Another settlement' };

/** Chapter 2 (Demo Guide steps 5–8): two separate exchanges, reservations, completion and what changed. */
export function Chapter2Exchanges({ w }: { w: DemoWalkthroughView }) {
  const { me } = useActAs();
  const { cooking, tutoring, comparison, trustUpdates } = w.story;
  const { mei, sam } = w.members;
  const offer = w.trust.cookingOffer;
  const bothSettled = cooking?.status === 'SETTLED' && tutoring?.status === 'SETTLED';
  const notDue = [cooking, tutoring].filter((e) => e && e.status === 'ACCEPTED' && new Date(e.scheduledAt) > new Date(w.now));
  return (
    <div className="space-y-4">
      <Step
        title="Mei requests two hours of cooking, then proposes one hour of tutoring"
        state={cooking && tutoring ? 'done' : 'ready'}
        note="Two separate agreements, each with its own terms. Nothing is reserved until both members accept the same version."
      >
        {!cooking ? (
          me?.handle === 'mei' && offer ? (
            <TermsForm
              mode="propose"
              myRole="recipient"
              counterpartyId={sam.id}
              counterpartyName={sam.displayName}
              listingId={offer.id}
              providerId={sam.id}
              init={{
                deliverable: 'Cook a two-course Malaysian dinner (nasi lemak + kuih) for Mei',
                category: 'Cooking',
                durationMinutes: 120,
                location: offer.location || 'North side',
                punctualityRequired: false,
                giftBonus: 0,
                cancellationNoticeHours: 24,
                cancellationTerms: 'Free cancellation up to 24 hours before.',
                confirmationDays: 3,
                // The listing's access level and requirements carry over, as on the Service Board.
                trustTier: offer.trustTier,
                minCredibility: offer.minCredibility,
                minRelationshipTrust: offer.minRelationshipTrust,
                maxCreditBudget: offer.maxCreditBudget,
              }}
              onDone={() => undefined}
            />
          ) : offer ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              Mei sends the request from Sam’s offer. <ActAsButton m={mei} why="to request the dinner" />
            </div>
          ) : (
            <p className="text-sm text-slate-600">Sam’s cooking offer is no longer open, so a new request can’t be made here.</p>
          )
        ) : !tutoring ? (
          me?.handle === 'mei' ? (
            <div className="space-y-2">
              <p className="text-sm text-emerald-800">✓ Cooking request saved ({duration(cooking.durationMinutes)}, {credits(cooking.creditAmount)} credits). Now the separate tutoring exchange:</p>
              <TermsForm
                mode="propose"
                myRole="provider"
                counterpartyId={sam.id}
                counterpartyName={sam.displayName}
                linkedExchangeId={cooking.id}
                providerId={mei.id}
                init={{
                  deliverable: 'One hour of secondary-school maths tutoring for Sam',
                  category: 'Tutoring',
                  durationMinutes: 60,
                  location: 'Online',
                  punctualityRequired: false,
                  giftBonus: 0,
                  cancellationNoticeHours: 12,
                  cancellationTerms: 'Free cancellation up to 12 hours before.',
                  confirmationDays: 3,
                }}
                onDone={() => undefined}
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              Cooking request saved. Mei now proposes the tutoring exchange. <ActAsButton m={mei} why="to propose tutoring" />
            </div>
          )
        ) : (
          <p className="text-sm text-slate-700">
            Both proposals are saved: {duration(cooking.durationMinutes)} cooking by Sam ({credits(cooking.creditAmount)} cr) and {duration(tutoring.durationMinutes)} tutoring by Mei ({credits(tutoring.creditAmount)} cr).
          </p>
        )}
      </Step>

      {(cooking || tutoring) && (
        <Step
          title="Sam accepts, credits are reserved, both confirm completion"
          state={bothSettled ? 'done' : 'ready'}
          note="Each exchange is accepted, reserved and confirmed on its own. Buttons appear for the member who is acting; switch members with one click."
        >
          <div className="grid gap-3 xl:grid-cols-2">
            {cooking && <ExchangePanel id={cooking.id} title="Exchange 1 · Cooking (Sam → Mei)" allow={['accept', 'confirm']} />}
            {tutoring && <ExchangePanel id={tutoring.id} title="Exchange 2 · Tutoring (Mei → Sam)" allow={['accept', 'confirm']} />}
          </div>
          {notDue.length > 0 && (
            <div className="mt-3">
              <ClockControl why={`Completion can only be confirmed after the service time (${[...new Set(notDue.map((e) => fmtDate(e!.scheduledAt)))].join(', ')}); the clock now reads ${fmtDate(w.now)}.`} />
            </div>
          )}
        </Step>
      )}

      <Step title="Reserved and available credits" state="info" note="Reserved credits stay with the payer but cannot be spent; they are paid only on settlement.">
        <BalanceTable w={w} />
      </Step>

      <Step
        title="What changed: before and after settlement"
        state={bothSettled ? 'done' : comparison.settled ? 'ready' : 'waiting'}
        note={comparison.settled ? `Read from the ledger, credibility snapshots and trust updates (${comparison.settled} of 2 exchanges settled).` : 'Appears once an exchange settles. Nothing here is estimated.'}
      >
        {comparison.settled > 0 && <Comparison w={w} />}
        {(trustUpdates.cooking || trustUpdates.tutoring) && (
          <Details title="Details: earned-trust updates">
            {[trustUpdates.cooking, trustUpdates.tutoring].filter(Boolean).map((u) => (
              <p key={u!.id} className="text-xs">
                <strong>{u!.exchangeDeliverable}</strong>: {u!.previousStrength} → {u!.newStrength}
                {u!.applied ? '' : ' (no change)'} — {u!.reason} ({fmtDate(u!.createdAt)})
              </p>
            ))}
          </Details>
        )}
      </Step>
    </div>
  );
}

function BalanceTable({ w }: { w: DemoWalkthroughView }) {
  const rows = [w.participants.mei, w.participants.sam];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 pr-3">Member</th>
            <th className="pr-3">Posted</th>
            <th className="pr-3">Reserved (outgoing)</th>
            <th className="pr-3">Available</th>
            <th>Pending incoming</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 num">
          {rows.map((p) => (
            <tr key={p.member.id}>
              <td className="py-1.5 pr-3 font-medium">{p.member.displayName}</td>
              <td className="pr-3">{credits(p.credits.posted)}</td>
              <td className="pr-3">{credits(p.credits.reservedOutgoing)}</td>
              <td className="pr-3">{credits(p.credits.available)}</td>
              <td>{credits(p.credits.pendingIncoming)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Available = posted − reserved. New commitments must keep available ≥ {credits(w.participants.mei.credits.floor)}.</p>
    </div>
  );
}

function Comparison({ w }: { w: DemoWalkthroughView }) {
  const { comparison } = w.story;
  const [meiRow, samRow] = comparison.rows;
  const name = (r: DemoComparisonRow) => (r.memberId === w.members.mei.id ? 'Mei' : 'Sam');
  const arrow = (a: number | null, b: number | null, f: (n: number) => string = String) => (a === null ? (b === null ? '—' : f(b)) : `${f(a)} → ${b === null ? '—' : f(b)}`);
  const ht = (r: DemoComparisonRow, s: number | null) => (s === null ? '—' : s >= r.highTrustThreshold ? 'eligible' : 'locked');
  const sum = (r: DemoComparisonRow) => r.serviceTransfers.reduce((a, t) => a + t.amount, 0);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-3" />
              <th className="pr-3">Mei</th>
              <th>Sam</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 num">
            {[w.story.cooking, w.story.tutoring].filter((e) => e && [...meiRow.serviceTransfers, ...samRow.serviceTransfers].some((t) => t.exchangeId === e.id)).map((e) => [e!.id, e!.deliverable] as const).map(([id, deliverable]) => (
              <tr key={id}>
                <td className="py-1.5 pr-3 text-slate-600">Service transfer: {deliverable}</td>
                {[meiRow, samRow].map((r) => (
                  <td key={r.memberId} className="pr-3">
                    {credits(r.serviceTransfers.find((t) => t.exchangeId === id)?.amount ?? 0, true)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 pr-3">Net from these exchanges</td>
              <td className="pr-3">{credits(sum(meiRow), true)}</td>
              <td>{credits(sum(samRow), true)}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-slate-600">Posted balance (before → now)</td>
              <td className="pr-3">{arrow(meiRow.postedBefore, meiRow.postedNow, (n) => credits(n))}</td>
              <td>{arrow(samRow.postedBefore, samRow.postedNow, (n) => credits(n))}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-slate-600">Reserved / available now</td>
              <td className="pr-3">
                {credits(meiRow.reservedNow)} / {credits(meiRow.availableNow)}
              </td>
              <td>
                {credits(samRow.reservedNow)} / {credits(samRow.availableNow)}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-slate-600">Earned relationship Mei ↔ Sam</td>
              <td colSpan={2}>{arrow(comparison.earned.before, comparison.earned.after)}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-slate-600">Relationship trust Mei ↔ Sam (strongest path)</td>
              <td colSpan={2}>
                {arrow(comparison.earned.relationshipTrustBefore, comparison.earned.relationshipTrustAfter)}
                {comparison.earned.relationshipTrustBefore !== null && comparison.earned.relationshipTrustBefore === comparison.earned.relationshipTrustAfter && (
                  <span className="block text-xs text-slate-500">Unchanged: the existing path is still stronger than the new direct link, and a new edge never lowers it.</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-slate-600">Credibility (before → after settlement)</td>
              <td className="pr-3">
                {arrow(meiRow.credibilityBefore, meiRow.credibilityAfter)}
                {meiRow.credibilityNow !== meiRow.credibilityAfter && <span className="text-xs text-slate-500"> · now {meiRow.credibilityNow}</span>}
              </td>
              <td>
                {arrow(samRow.credibilityBefore, samRow.credibilityAfter)}
                {samRow.credibilityNow !== samRow.credibilityAfter && <span className="text-xs text-slate-500"> · now {samRow.credibilityNow}</span>}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-slate-600">High-trust tasks (needs {meiRow.highTrustThreshold})</td>
              <td className="pr-3">
                {ht(meiRow, meiRow.credibilityBefore)} → {ht(meiRow, meiRow.credibilityAfter)}
              </td>
              <td>
                {ht(samRow, samRow.credibilityBefore)} → {ht(samRow, samRow.credibilityAfter)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-600">
        The two services are not treated as equal: cooking was {w.story.cooking ? duration(w.story.cooking.durationMinutes) : '—'} and tutoring {w.story.tutoring ? duration(w.story.tutoring.durationMinutes) : '—'}, so each settles its own amount. High-trust eligibility still needs Alice’s explicit approval for her home.
      </p>
      {[meiRow, samRow].some((r) => r.otherPostings.length > 0) && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
          <p className="font-semibold">Not from these exchanges</p>
          <ul className="mt-1 space-y-0.5">
            {[meiRow, samRow].flatMap((r) =>
              r.otherPostings.map((p, i) => (
                <li key={`${r.memberId}-${i}`}>
                  {name(r)}: {LEDGER_KIND[p.kind] ?? p.kind} {credits(p.amount, true)} on {fmtDate(p.effectiveAt)} — {p.explanation}
                </li>
              )),
            )}
          </ul>
          <p className="mt-1">These come from simulated-time changes (the daily job and expiry), not from the services above.</p>
        </div>
      )}
    </div>
  );
}
