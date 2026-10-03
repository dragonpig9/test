import clsx from 'clsx';
import { useState } from 'react';
import type { DemoWalkthroughView } from '@commonhours/shared';
import { MemberChip } from '../../../components/MemberChip';
import { ErrorBox, Loading, StatusChip } from '../../../components/ui';
import { credits, fmtDate } from '../../../lib/format';
import { JurySelection, NeedsReview } from '../../disputes/DisputeDetailPage';
import { useDispute } from '../../disputes/api';
import { useExchange } from '../../exchanges/api';
import { TermsForm } from '../../exchanges/TermsForm';
import { EligibilityPanel } from '../../task-eligibility/EligibilityPanel';
import { ActAsButton, Details, ExchangePanel, useActAs } from './parts';

const CASES = [
  { key: 'home', title: 'Home access needs the owner’s explicit approval' },
  { key: 'skills', title: 'Peer-reviewed skill tiers' },
  { key: 'floor', title: 'Credit-floor rejection' },
  { key: 'jury', title: 'Too few eligible jurors (NEEDS_REVIEW)' },
  { key: 'expiry', title: 'Credit expiry' },
] as const;
type CaseKey = (typeof CASES)[number]['key'];

/** Optional extensions to the main walkthrough. Each opens a compact example built from existing records. */
export function EdgeCases({ w }: { w: DemoWalkthroughView }) {
  const [open, setOpen] = useState<CaseKey | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">Optional. Each case uses records already in the demo community and the same components as the full app. Blocked or unresolved cases are shown as they are.</p>
      {CASES.map((c) => (
        <section key={c.key} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button type="button" className="flex w-full items-center justify-between gap-2 p-4 text-left" aria-expanded={open === c.key} onClick={() => setOpen(open === c.key ? null : c.key)}>
            <span className="font-semibold text-slate-900">{c.title}</span>
            <span aria-hidden className={clsx('text-slate-400 transition', open === c.key && 'rotate-90')}>
              ▸
            </span>
          </button>
          {open === c.key && (
            <div className="border-t border-slate-100 p-4">
              {c.key === 'home' && <HomeAccess w={w} />}
              {c.key === 'skills' && <Skills w={w} />}
              {c.key === 'floor' && <CreditFloor w={w} />}
              {c.key === 'jury' && <Kettle w={w} />}
              {c.key === 'expiry' && <Expiry w={w} />}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function HomeAccess({ w }: { w: DemoWalkthroughView }) {
  const { me } = useActAs();
  const task = w.trust.catTask;
  const id = w.edgeCases.catExchangeId;
  const { mei, alice } = w.members;
  return (
    <div className="space-y-3 text-sm">
      <p>
        Alice’s request <strong>{task?.title ?? 'Feed my cat and water plants while I’m away'}</strong> means entering her home while she is away. Meeting the credibility threshold only lets Mei offer; Alice must still press <em>Approve home access</em> for this exchange. Her address is shown only to the provider of an accepted exchange.
      </p>
      {id ? (
        <ExchangePanel id={id} title="Mei → Alice · cat-sitting" allow={['approveHomeAccess', 'accept']}>
          <HomeAddress id={id} />
        </ExchangePanel>
      ) : task?.eligibility?.locked ? (
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="font-medium">🔒 Mei can’t offer yet: credibility {task.eligibility.currentCredibility} of {task.eligibility.requiredCredibility} needed.</p>
          <p className="mt-1 text-xs text-slate-600">Completing chapter 2 settles two exchanges, which is how her record grows.</p>
          <Details title="Details: every eligibility check">
            <EligibilityPanel e={task.eligibility} />
          </Details>
        </div>
      ) : task ? (
        me?.handle === 'mei' ? (
          <TermsForm
            mode="propose"
            myRole="provider"
            counterpartyId={alice.id}
            counterpartyName={alice.displayName}
            listingId={task.id}
            providerId={mei.id}
            init={{
              deliverable: 'Feed Juniper and water the balcony plants, twice during Alice’s week away',
              category: 'Other',
              durationMinutes: 60,
              location: task.location,
              punctualityRequired: false,
              giftBonus: 0,
              cancellationNoticeHours: 24,
              cancellationTerms: 'Free cancellation up to 24 hours before.',
              confirmationDays: 3,
              trustTier: task.trustTier,
              minCredibility: task.minCredibility,
              minRelationshipTrust: task.minRelationshipTrust,
              maxCreditBudget: task.maxCreditBudget,
            }}
            onDone={() => undefined}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            Mei now meets the credibility requirement and can offer. <ActAsButton m={mei} why="to offer" />
          </div>
        )
      ) : (
        <p className="text-slate-600">Alice’s request is no longer open in this shared demo.</p>
      )}
    </div>
  );
}

/** Only rendered from the exchange endpoint, which returns the address solely to the accepted provider. */
function HomeAddress({ id }: { id: string }) {
  const q = useExchange(id);
  const e = q.data?.exchange;
  if (!e) return null;
  return q.data?.homeAddress ? (
    <p className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-2 text-xs">
      <strong>Private address (visible to you as the provider):</strong> {q.data.homeAddress}
    </p>
  ) : (
    <p className="mt-2 text-xs text-slate-500">
      Home access: {e.homeAccess.approved ? `approved by Alice ${fmtDate(e.homeAccess.approvedAt)}` : 'not approved yet'}. The address is hidden{e.myRole === 'provider' ? ' until both have accepted' : ' from everyone except the provider of an accepted exchange'}.
    </p>
  );
}

function Skills({ w }: { w: DemoWalkthroughView }) {
  const claims = w.edgeCases.meiSkillClaims;
  return (
    <div className="space-y-2 text-sm">
      <p>A member can claim a skill tier with evidence, but a claim changes no price until a reviewer with enough credibility (and no conflict) approves it.</p>
      {claims.map((c) => (
        <div key={c.id} className="rounded-xl border border-slate-200 p-3">
          <p className="font-medium">
            {c.member.displayName}: {c.category} · {c.tier.toLowerCase()} <StatusChip status={c.status === 'APPROVED' ? 'CONFIRMED' : c.status === 'DECLINED' ? 'REFUTED' : 'PENDING'} label={c.status.toLowerCase()} />
          </p>
          <p className="mt-1 text-xs text-slate-600">Evidence: {c.evidence}</p>
          <p className="mt-1 text-xs text-slate-600">
            Approvals {c.approvals} of {c.requiredApprovals} · record: {c.record.settledServices} settled {c.category.toLowerCase()} service(s)
          </p>
          {c.reviews.map((r) => (
            <p key={r.reviewer.id} className="mt-1 text-xs">
              {r.approve ? '✓' : '✗'} <MemberChip m={r.reviewer} /> “{r.note}” · {fmtDate(r.createdAt)}
            </p>
          ))}
        </div>
      ))}
      {!claims.length && <p className="text-slate-600">No skill claims recorded for Mei.</p>}
      {w.trust.translationOffer?.priceEstimate && (
        <p className="text-xs text-slate-600">Effect on price: {w.trust.translationOffer.priceEstimate.skill.reason}</p>
      )}
    </div>
  );
}

function CreditFloor({ w }: { w: DemoWalkthroughView }) {
  const id = w.edgeCases.floorExchangeId;
  const b = w.edgeCases.benCredits;
  return (
    <div className="space-y-3 text-sm">
      <p>Kofi proposed a 3-hour repair for Ben. Accepting reserves the full price from Ben, and nobody may commit below the −5 available-credit floor.</p>
      {b && (
        <p className="rounded-lg bg-slate-50 p-2 text-xs">
          Ben now: posted {credits(b.posted)} · reserved {credits(b.reservedOutgoing)} · available <strong>{credits(b.available)}</strong> · floor {credits(b.floor)} · headroom {credits(b.headroom)}
        </p>
      )}
      {id ? (
        <ExchangePanel id={id} title="Kofi → Ben · washing machine door seal" allow={['accept']} />
      ) : (
        <p className="text-slate-600">The proposal is no longer in the demo data.</p>
      )}
      <p className="text-xs text-slate-500">Act as Ben and press Accept: the backend blocks it and explains why. Nothing is reserved.</p>
    </div>
  );
}

function Kettle({ w }: { w: DemoWalkthroughView }) {
  const id = w.edgeCases.kettleDisputeId;
  const q = useDispute(id ?? undefined);
  if (!id) return <p className="text-sm text-slate-600">The seeded kettle dispute is not in the demo data.</p>;
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const d = q.data.dispute;
  const r = d.exchange.reservation;
  return (
    <div className="space-y-3 text-sm">
      <p>
        Lena disputes Kofi’s kettle repair (“{d.claim}”). The first juror voted <em>unclear</em>, which needs a panel of three, but declared conflicts and the distance rule leave too few eligible members in this small community.
      </p>
      <p>
        Status: <StatusChip status={d.status} /> · reservation {r ? <><StatusChip status={r.status} /> {credits(r.total)} cr</> : '—'}
      </p>
      {d.status === 'NEEDS_REVIEW' ? <NeedsReview d={d} party={d.exchange.myRole !== 'observer'} /> : <p className="text-slate-600">Someone in the shared demo has moved this dispute on; it is now {d.status.toLowerCase().replace(/_/g, ' ')}.</p>}
      <Details title="Details: candidates and exclusion reasons">
        <JurySelection d={d} />
      </Details>
    </div>
  );
}

function Expiry({ w }: { w: DemoWalkthroughView }) {
  const t = w.edgeCases.tomasCredits;
  if (!t) return <p className="text-sm text-slate-600">Tomás is not in the demo data.</p>;
  const expired = t.lots.filter((l) => l.expired);
  const live = t.lots.filter((l) => !l.expired && l.remaining > 0);
  return (
    <div className="space-y-3 text-sm">
      <p>Tomás earns but rarely spends. Earned credits expire 12 months after they were earned (oldest first) and move into the Community Credit Pool; debts never expire.</p>
      <p className="rounded-lg bg-slate-50 p-2 text-xs">
        Posted {credits(t.posted)} · next expiry {fmtDate(t.expiry.nextExpiryAt, false)} · expiring within 30 days: {credits(t.expiry.expiringWithin30Days)}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-2">Earned</th>
              <th className="pr-2">Expires</th>
              <th className="pr-2">Original</th>
              <th className="pr-2">Remaining</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 num">
            {[...expired, ...live].map((l) => (
              <tr key={l.id}>
                <td className="py-1 pr-2">{fmtDate(l.earnedAt, false)}</td>
                <td className="pr-2">{fmtDate(l.expiresAt, false)}</td>
                <td className="pr-2">{credits(l.originalAmount)}</td>
                <td className="pr-2">{credits(l.remaining)}</td>
                <td>{l.expired ? 'expired → pool' : 'active'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{t.expiry.note}</p>
    </div>
  );
}
