import type { Exchange } from '@prisma/client';
import type { PriceBreakdown } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import { addDays } from '../../core/dates';
import type { Db } from '../../core/db';
import { scoreOf } from '../credibility/credibility.service';
import { categoryMinimum } from '../task-eligibility/eligibility.rules';
import { effectiveSkillTier } from './pricing.skills';
import { computeQuote, demandMultiplier, legacyBreakdown, type DemandResult } from './pricing.rules';

/**
 * Demand inputs from real records, for one category at `now`:
 *  - unique active requests: OPEN request listings in the category, created within the demand
 *    window (older = expired), whose owner is active, with no accepted/settled/disputed exchange
 *    yet (unmatched); several requests from the same person count once.
 *  - available eligible providers: distinct active members with an OPEN offer in the category who
 *    meet the category's credibility minimum (e.g. Equipment repair ≥ 25).
 */
export async function demandFor(db: Db, category: string, now: Date): Promise<DemandResult & { inputs: PriceBreakdown['demand']['inputs'] }> {
  const windowDays = POLICY.pricing.demand.windowDays;
  const since = addDays(now, -windowDays);
  const [requests, offers] = await Promise.all([
    db.listing.findMany({
      where: { type: 'REQUEST', status: 'OPEN', category, owner: { status: 'ACTIVE' } },
      select: { ownerId: true, createdAt: true, exchanges: { select: { status: true } } },
    }),
    db.listing.findMany({ where: { type: 'OFFER', status: 'OPEN', category, owner: { status: 'ACTIVE' } }, select: { ownerId: true } }),
  ]);
  const unmatched = requests.filter((r) => !r.exchanges.some((e) => ['ACCEPTED', 'DISPUTED', 'SETTLED'].includes(e.status)));
  const fresh = unmatched.filter((r) => r.createdAt.getTime() > since.getTime());
  const uniqueRequesters = new Set(fresh.map((r) => r.ownerId));
  const minScore = categoryMinimum(category);
  const providers = new Set<string>();
  for (const id of new Set(offers.map((o) => o.ownerId))) {
    if (minScore === 0 || (await scoreOf(db, id, now)) >= minScore) providers.add(id);
  }
  const d = demandMultiplier(uniqueRequesters.size, providers.size);
  return {
    ...d,
    inputs: {
      uniqueActiveRequests: uniqueRequesters.size,
      availableProviders: providers.size,
      ratio: d.ratio,
      windowDays,
      excludedExpired: unmatched.length - fresh.length,
      excludedDuplicates: fresh.length - uniqueRequesters.size,
    },
  };
}

export interface QuoteRequest {
  providerId: string;
  category: string;
  durationMinutes: number;
  giftBonus: number;
  maxCreditBudget: number | null;
}

export async function quoteFor(db: Db, q: QuoteRequest, now: Date): Promise<PriceBreakdown> {
  const [skill, demand] = await Promise.all([effectiveSkillTier(db, q.providerId, q.category), demandFor(db, q.category, now)]);
  return computeQuote({ durationMinutes: q.durationMinutes, skill, demand, giftBonus: q.giftBonus, maxCreditBudget: q.maxCreditBudget, now });
}

/** Locked snapshot after acceptance, otherwise the current quote; legacy exchanges get their 1h = 1 credit breakdown. */
export function pricingOf(ex: Pick<Exchange, 'pricingQuote' | 'priceSnapshot' | 'durationMinutes' | 'creditAmount' | 'giftBonus' | 'acceptedAt' | 'createdAt' | 'baseCredits'>): PriceBreakdown {
  const stored = (ex.priceSnapshot ?? ex.pricingQuote) as PriceBreakdown | null;
  if (stored && ex.baseCredits !== null) return stored;
  return legacyBreakdown(ex);
}

/** Memoised estimates for a list of listings (one demand lookup per category, one tier per provider/category). */
export function estimator(db: Db, now: Date) {
  const demand = new Map<string, ReturnType<typeof demandFor>>();
  const tiers = new Map<string, ReturnType<typeof effectiveSkillTier>>();
  return async (providerId: string, category: string, durationMinutes: number, maxCreditBudget: number | null) => {
    if (!demand.has(category)) demand.set(category, demandFor(db, category, now));
    const tk = `${providerId}|${category}`;
    if (!tiers.has(tk)) tiers.set(tk, effectiveSkillTier(db, providerId, category));
    return computeQuote({ durationMinutes, skill: await tiers.get(tk)!, demand: await demand.get(category)!, giftBonus: 0, maxCreditBudget, now });
  };
}
