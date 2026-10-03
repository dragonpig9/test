import type { DemoWalkthroughView } from '@commonhours/shared';
import { Loading } from '../../../components/ui';
import { credits, duration } from '../../../lib/format';
import { useExchange } from '../../exchanges/api';
import { TermsForm } from '../../exchanges/TermsForm';
import { PriceBreakdown } from '../../pricing/PriceBreakdown';
import { ActAsButton, Details, ExchangePanel, Step, useActAs } from './parts';

/** Chapter 3 (Demo Guide step 9): a new, separate translation exchange priced by skill tier and demand. */
export function Chapter3Pricing({ w }: { w: DemoWalkthroughView }) {
  const { me } = useActAs();
  const { translation, cooking, tutoring } = w.story;
  const { mei, sam } = w.members;
  const offer = w.trust.translationOffer;
  const accepted = !!translation && translation.status !== 'PROPOSED';
  const earlierSettled = cooking?.status === 'SETTLED' && tutoring?.status === 'SETTLED';
  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        This is a <strong>new exchange</strong>, separate from the cooking and tutoring exchanges{earlierSettled ? ', which are already settled and stay unchanged' : ''}. Sam asks Mei to translate a letter.
      </p>
      <Step title="Sam requests Mei’s translation, with punctuality as a condition" state={translation ? 'done' : 'ready'} note="The price preview below comes from the pricing API: hours × peer-reviewed skill tier × measured demand.">
        {translation ? (
          <p className="text-sm text-slate-700">
            ✓ Request saved: {translation.deliverable} · {duration(translation.durationMinutes)} · punctuality {translation.punctualityRequired ? 'is an agreed condition' : 'was not made a condition'}.
          </p>
        ) : !offer ? (
          <p className="text-sm text-slate-600">Mei’s translation offer is no longer open, so a new request can’t be made here.</p>
        ) : me?.handle === 'sam' ? (
          <TermsForm
            mode="propose"
            myRole="recipient"
            counterpartyId={mei.id}
            counterpartyName={mei.displayName}
            listingId={offer.id}
            providerId={mei.id}
            init={{
              deliverable: 'Translate a one-page tenancy letter from Mandarin into English',
              category: 'Translation',
              durationMinutes: 60,
              location: 'Online',
              punctualityRequired: true,
              giftBonus: 0,
              cancellationNoticeHours: 12,
              cancellationTerms: 'Free cancellation up to 12 hours before.',
              confirmationDays: 3,
              // The listing's access level and requirements carry over, as on the Service Board.
              trustTier: offer.trustTier,
              minCredibility: offer.minCredibility,
              minRelationshipTrust: offer.minRelationshipTrust,
              maxCreditBudget: offer.maxCreditBudget,
            }}
            onDone={() => undefined}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            Sam sends the request from Mei’s offer. <ActAsButton m={sam} why="to request the translation" />
          </div>
        )}
      </Step>

      {translation && (
        <Step title={accepted ? 'Price locked at acceptance' : 'Mei reviews the price and accepts'} state={accepted ? 'done' : 'ready'}>
          <PriceSummary id={translation.id} />
          <div className="mt-3">
            <ExchangePanel id={translation.id} title="Exchange 3 · Translation (Mei → Sam)" allow={['accept']} />
          </div>
        </Step>
      )}
      {!translation && offer?.priceEstimate && (
        <Details title="Details: Mei’s current price for one hour">
          <PriceBreakdown price={offer.priceEstimate} />
        </Details>
      )}
    </div>
  );
}

/** The stored quote (before acceptance) or locked price snapshot (after), shown as the backend recorded it. */
function PriceSummary({ id }: { id: string }) {
  const q = useExchange(id);
  if (q.isLoading) return <Loading label="Loading the price…" />;
  const e = q.data?.exchange;
  const p = e?.pricing;
  if (!e || !p) return null;
  const x = (n: number) => `×${(n / 100).toFixed(2)}`;
  return (
    <div className="space-y-2">
      <div className="grid gap-2 text-sm sm:grid-cols-5">
        <Fact label="Duration" value={duration(p.durationMinutes)} />
        <Fact label="Skill tier" value={`${p.skill.tier.toLowerCase()} ${x(p.skill.multiplierPct)}`} sub={p.skill.source === 'peer-reviewed' ? 'peer-reviewed' : 'default'} />
        <Fact label="Demand" value={x(p.demand.multiplierPct)} sub={p.demand.status === 'APPLIED' ? `${p.demand.inputs.uniqueActiveRequests} requests ÷ ${p.demand.inputs.availableProviders} provider(s)` : p.demand.status.toLowerCase().replace(/_/g, ' ')} />
        <Fact label="Final price" value={`${credits(p.total)} cr`} strong />
        <Fact label="Punctuality" value={e.punctualityRequired ? 'Agreed condition' : 'Not a condition'} />
      </div>
      <p className="font-mono text-xs text-slate-600">{p.calculation}</p>
      <p className="text-xs text-slate-600">{e.priceLocked ? 'Both accepted: this price is locked and later demand changes can’t alter it.' : 'Quoted for this terms version. Accepting locks exactly this price.'}</p>
      <Details title="Details: full price breakdown">
        <PriceBreakdown price={p} />
      </Details>
    </div>
  );
}

function Fact({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={strong ? 'text-lg font-semibold num text-brand-800' : 'font-medium'}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}
