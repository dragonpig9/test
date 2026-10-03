import type { PriceBreakdown as Price } from '@commonhours/shared';
import clsx from 'clsx';
import { credits, duration, fmtDate } from '../../lib/format';

const pct = (n: number) => `×${(n / 100).toFixed(2)}`;
const DEMAND_LABEL: Record<Price['demand']['status'], string> = {
  APPLIED: 'from current demand',
  INSUFFICIENT_DATA: 'insufficient data',
  WAITING_FOR_PROVIDER: 'waiting for a provider',
};

/** Renders the backend's price breakdown. It never recomputes anything. */
export function PriceBreakdown({ price, compact }: { price: Price; compact?: boolean }) {
  if (compact) {
    return (
      <span title={price.calculation}>
        ≈ <strong>{credits(price.total)}</strong> credit(s)
        {(price.skill.multiplierPct !== 100 || price.demand.multiplierPct !== 100) && (
          <span className="text-slate-500">
            {' '}
            ({pct(price.skill.multiplierPct)} skill · {pct(price.demand.multiplierPct)} demand)
          </span>
        )}
        {price.demand.status === 'WAITING_FOR_PROVIDER' && <span className="text-amber-700"> · waiting for a provider</span>}
      </span>
    );
  }
  const rows: [string, string, string | null][] = [
    ['Duration', duration(price.durationMinutes), null],
    ['Base credits', credits(price.baseCredits), '1 hour = 1 credit'],
    ['Skill multiplier', `${pct(price.skill.multiplierPct)} · ${price.skill.tier.toLowerCase()}`, price.skill.reason],
    ['Demand multiplier', `${pct(price.demand.multiplierPct)} · ${DEMAND_LABEL[price.demand.status]}`, price.demand.reason],
    ['Service credits', credits(price.serviceCredits), null],
    ['Gift bonus', price.giftBonus ? credits(price.giftBonus) : 'none', price.giftBonus ? 'Voluntary, from the recipient, agreed before work starts.' : null],
  ];
  return (
    <div className="text-sm">
      {price.legacy && <p className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">Agreed before skill and demand pricing existed — the historical price is kept unchanged.</p>}
      <dl className="divide-y divide-slate-100">
        {rows.map(([k, v, why]) => (
          <div key={k} className="grid grid-cols-[9rem_1fr] gap-2 py-1.5">
            <dt className="text-slate-500">{k}</dt>
            <dd>
              <span className="font-medium text-slate-900">{v}</span>
              {why && <span className="block text-xs text-slate-500">{why}</span>}
            </dd>
          </div>
        ))}
        <div className="grid grid-cols-[9rem_1fr] gap-2 py-2">
          <dt className="font-semibold text-slate-900">Final total</dt>
          <dd className="text-lg font-semibold num text-brand-800">{credits(price.total)} credit(s)</dd>
        </div>
      </dl>
      <p className="mt-1 font-mono text-[11px] text-slate-600">{price.calculation}</p>
      {price.maxCreditBudget !== null && (
        <p className={clsx('mt-2 rounded-lg p-2 text-xs', price.withinBudget ? 'bg-brand-50 text-brand-900' : 'bg-red-50 text-red-900')}>
          Requester’s maximum budget: {credits(price.maxCreditBudget)} — {price.withinBudget ? 'within budget' : 'over budget; this cannot be proposed or accepted'}.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {price.lockedAt ? `Locked when both accepted (${fmtDate(price.lockedAt)}); later demand changes never change it.` : `Quoted ${fmtDate(price.quotedAt)}. Both parties accept this exact price; it is locked at acceptance.`} {price.rounding}
      </p>
    </div>
  );
}
