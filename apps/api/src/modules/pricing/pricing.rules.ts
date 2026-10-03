import { minutesToCreditUnits, type PriceBreakdown, type SkillTier } from '@commonhours/shared';
import { POLICY } from '../../config/policy';

/**
 * Explainable pricing (pure, unit tested). All amounts are integers in hundredths of a credit and
 * all multipliers are integer percentages, so no floating point touches a price.
 *
 *   base credits    = hours × 100                          (existing 1 h = 1 credit rule)
 *   service credits = round½↑(base × skill% × demand% / 10 000)
 *   total           = service credits + optional pre-agreed gift bonus
 *
 * Rounding rule (the only one): half-up to the nearest 0.01 credit, applied once to the product.
 * Demand multiplier: ratio = unique active requests / available eligible providers,
 *   demand% = clamp(100 + 10 × (ratio − 1), 100, 150), itself rounded half-up to a whole percent.
 */
const P = POLICY.pricing;

/** Integer division rounding half up (inputs are non-negative integers, d > 0). */
export function divRoundHalfUp(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

export function pct(n: number): string {
  return (n / 100).toFixed(2);
}

export function skillMultiplierPct(tier: SkillTier): number {
  return P.skillTiers[tier].multiplierPct;
}

export interface DemandResult {
  multiplierPct: number;
  status: PriceBreakdown['demand']['status'];
  ratio: number | null;
  reason: string;
}

export function demandMultiplier(uniqueRequests: number, providers: number): DemandResult {
  const D = P.demand;
  if (providers <= 0) {
    return {
      multiplierPct: 100,
      status: 'WAITING_FOR_PROVIDER',
      ratio: null,
      reason: `Waiting for a provider: no available eligible providers offer this category right now, so no demand premium is applied (×1.00). The price can never grow without limit.`,
    };
  }
  if (uniqueRequests < D.minUniqueRequests) {
    return {
      multiplierPct: 100,
      status: 'INSUFFICIENT_DATA',
      ratio: null,
      reason: `Insufficient data: ${uniqueRequests} unique active request(s) in the last ${D.windowDays} days (needs at least ${D.minUniqueRequests}), so demand is ×1.00.`,
    };
  }
  const ratio = Math.round((uniqueRequests / providers) * 100) / 100;
  const raw = uniqueRequests <= providers ? D.minPct : D.minPct + divRoundHalfUp(D.slopePct * (uniqueRequests - providers), providers);
  const m = Math.min(D.maxPct, Math.max(D.minPct, raw));
  return {
    multiplierPct: m,
    status: 'APPLIED',
    ratio,
    reason: `${uniqueRequests} unique active request(s) ÷ ${providers} available provider(s) = ${ratio}; 1 + ${pct(D.slopePct)} × (${ratio} − 1) = ${pct(raw)}${m !== raw ? `, bounded to ${pct(m)}` : ''} (allowed range ${pct(D.minPct)}–${pct(D.maxPct)}).`,
  };
}

export interface QuoteInput {
  durationMinutes: number;
  skill: { tier: SkillTier; source: PriceBreakdown['skill']['source']; reason: string };
  demand: DemandResult & { inputs: PriceBreakdown['demand']['inputs'] };
  giftBonus: number;
  maxCreditBudget: number | null;
  now: Date;
}

export function computeQuote(i: QuoteInput): PriceBreakdown {
  const base = minutesToCreditUnits(i.durationMinutes);
  const skillPct = skillMultiplierPct(i.skill.tier);
  const service = divRoundHalfUp(base * skillPct * i.demand.multiplierPct, 10_000);
  const total = service + i.giftBonus;
  const c = (n: number) => (n / 100).toString();
  return {
    durationMinutes: i.durationMinutes,
    baseCredits: base,
    skill: { tier: i.skill.tier, multiplierPct: skillPct, source: i.skill.source, reason: i.skill.reason },
    demand: { multiplierPct: i.demand.multiplierPct, status: i.demand.status, reason: i.demand.reason, inputs: i.demand.inputs },
    serviceCredits: service,
    giftBonus: i.giftBonus,
    total,
    maxCreditBudget: i.maxCreditBudget,
    withinBudget: i.maxCreditBudget === null || total <= i.maxCreditBudget,
    formula: 'service credits = hours × skill multiplier × demand multiplier; total = service credits + gift bonus',
    calculation: `${c(base)} h × ${pct(skillPct)} (${i.skill.tier.toLowerCase()}) × ${pct(i.demand.multiplierPct)} (demand) = ${c(service)} service credit(s)${i.giftBonus ? ` + ${c(i.giftBonus)} gift` : ''} = ${c(total)} total`,
    rounding: 'Integer hundredths of a credit; the product is rounded half-up to 0.01 credit once.',
    quotedAt: i.now.toISOString(),
    lockedAt: null,
    policyVersion: POLICY.version,
  };
}

/** Breakdown for exchanges created before premium pricing (1 hour = 1 credit, gift separate). */
export function legacyBreakdown(ex: { durationMinutes: number; creditAmount: number; giftBonus: number; acceptedAt: Date | null; createdAt: Date }): PriceBreakdown {
  const c = (n: number) => (n / 100).toString();
  return {
    durationMinutes: ex.durationMinutes,
    baseCredits: ex.creditAmount,
    skill: { tier: 'STANDARD', multiplierPct: 100, source: 'default', reason: 'Agreed before skill and demand pricing existed.' },
    demand: {
      multiplierPct: 100,
      status: 'INSUFFICIENT_DATA',
      reason: 'Agreed before demand pricing existed.',
      inputs: { uniqueActiveRequests: 0, availableProviders: 0, ratio: null, windowDays: P.demand.windowDays, excludedExpired: 0, excludedDuplicates: 0 },
    },
    serviceCredits: ex.creditAmount,
    giftBonus: ex.giftBonus,
    total: ex.creditAmount + ex.giftBonus,
    maxCreditBudget: null,
    withinBudget: true,
    formula: 'Historical price: 1 hour = 1 credit (kept unchanged).',
    calculation: `${c(ex.creditAmount)} credit(s)${ex.giftBonus ? ` + ${c(ex.giftBonus)} gift` : ''} = ${c(ex.creditAmount + ex.giftBonus)} total`,
    rounding: 'n/a',
    quotedAt: ex.createdAt.toISOString(),
    lockedAt: ex.acceptedAt?.toISOString() ?? null,
    policyVersion: 'policy-2026.10-v1',
    legacy: true,
  };
}
