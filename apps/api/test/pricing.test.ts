import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, addHours } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { acceptExchange } from '../src/modules/exchanges/exchange.service';
import { creditSummary } from '../src/modules/ledger/ledger.service';
import { computeQuote, demandMultiplier, divRoundHalfUp } from '../src/modules/pricing/pricing.rules';
import { quoteFor } from '../src/modules/pricing/pricing.service';
import { createSkillClaim, effectiveSkillTier, reviewSkillClaim } from '../src/modules/pricing/pricing.skills';
import { createListing } from '../src/modules/services/listing.service';
import { T0, agreed, community, proposed, reset, run, settleBoth } from './fixtures';

const noDemand = { ...demandMultiplier(0, 1), inputs: { uniqueActiveRequests: 0, availableProviders: 1, ratio: null, windowDays: 45, excludedExpired: 0, excludedDuplicates: 0 } };

describe('pricing rules (pure)', () => {
  it('2 h × 1.5 skill × 1.2 demand = 3.6 credits, plus the gift shown separately', () => {
    const demand = { ...demandMultiplier(3, 1), inputs: { uniqueActiveRequests: 3, availableProviders: 1, ratio: 3, windowDays: 45, excludedExpired: 0, excludedDuplicates: 0 } };
    expect(demand).toMatchObject({ multiplierPct: 120, status: 'APPLIED' });
    const q = computeQuote({ durationMinutes: 120, skill: { tier: 'ADVANCED', source: 'peer-reviewed', reason: '' }, demand, giftBonus: 50, maxCreditBudget: null, now: T0 });
    expect(q).toMatchObject({ baseCredits: 200, serviceCredits: 360, giftBonus: 50, total: 410, withinBudget: true });
    expect(q.calculation).toBe('2 h × 1.50 (advanced) × 1.20 (demand) = 3.6 service credit(s) + 0.5 gift = 4.1 total');
  });
  it('bounds the demand multiplier to 1.00–1.50 and handles edge cases without dividing by zero', () => {
    expect(demandMultiplier(100, 1)).toMatchObject({ multiplierPct: 150, status: 'APPLIED' });
    expect(demandMultiplier(1, 5)).toMatchObject({ multiplierPct: 100, status: 'INSUFFICIENT_DATA' });
    expect(demandMultiplier(2, 5)).toMatchObject({ multiplierPct: 100, status: 'APPLIED' }); // fewer requests than providers
    const none = demandMultiplier(10, 0);
    expect(none).toMatchObject({ multiplierPct: 100, status: 'WAITING_FOR_PROVIDER', ratio: null });
    expect(none.reason).toMatch(/Waiting for a provider/);
    expect(demandMultiplier(5, 2).multiplierPct).toBe(115); // ratio 2.5 → 1 + 0.1 × 1.5
  });
  it('uses one documented rounding rule: integer hundredths, half-up once', () => {
    expect(divRoundHalfUp(114125, 1000)).toBe(114);
    expect(divRoundHalfUp(1125, 10)).toBe(113);
    // 50 min = 83 units; × 1.25 × 1.10 = 114.125 → 114 (1.14 credits).
    const q = computeQuote({ durationMinutes: 50, skill: { tier: 'SKILLED', source: 'peer-reviewed', reason: '' }, demand: { ...noDemand, multiplierPct: 110 }, giftBonus: 0, maxCreditBudget: null, now: T0 });
    expect(q.serviceCredits).toBe(114);
  });
  it('flags quotes above the requester budget', () => {
    const q = computeQuote({ durationMinutes: 120, skill: { tier: 'SPECIALIST', source: 'peer-reviewed', reason: '' }, demand: noDemand, giftBonus: 0, maxCreditBudget: 300, now: T0 });
    expect(q).toMatchObject({ serviceCredits: 400, withinBudget: false });
  });
});

describe('pricing (integration)', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await reset();
    ids = await community(['a', 'pro', 'r1', 'r2', 'r3', 'rev'], [
      ['a', 'pro', 0.7],
      ['a', 'r1', 0.7],
      ['a', 'r2', 0.7],
      ['a', 'r3', 0.7],
      ['a', 'rev', 1.0],
    ]);
  });

  const request = (h: string, when = T0) =>
    run(ids[h], when, (tx, ctx) => createListing(tx, ctx, ids[h], { type: 'REQUEST', title: `Translate for ${h}`, description: 'A letter.', category: 'Translation', durationMinutes: 60, locationType: 'ONLINE', location: '', availability: 'Any', requiredSkills: [] }));
  const offer = (h: string) =>
    run(ids[h], T0, (tx, ctx) => createListing(tx, ctx, ids[h], { type: 'OFFER', title: `Translation by ${h}`, description: 'Letters and forms.', category: 'Translation', durationMinutes: 60, locationType: 'ONLINE', location: '', availability: 'Any', requiredSkills: [] }));

  async function makeReviewer() {
    // rev: 1.0 vouch (20) + rate 15 + 2 services (8) = 43 ≥ 40.
    for (let i = 0; i < 2; i++) {
      const ex = await agreed(ids.rev, ids.a, 60, addDays(T0, -40 + i));
      await settleBoth(ex.id, ids.rev, ids.a, addHours(addDays(T0, -40 + i), 2));
    }
  }

  it('self-claiming a tier changes nothing until a qualified peer approves it', async () => {
    const claim = await run(ids.pro, T0, (tx, ctx) => createSkillClaim(tx, ctx, ids.pro, { category: 'Translation', tier: 'SPECIALIST', evidence: 'I am an expert translator, trust me.' }));
    expect((await effectiveSkillTier(prisma, ids.pro, 'Translation')).tier).toBe('STANDARD');
    await expect(run(ids.pro, T0, (tx, ctx) => reviewSkillClaim(tx, ctx, claim.id, ids.pro, true, 'looks good'))).rejects.toMatchObject({ code: 'SKILL_REVIEW_NOT_ALLOWED' });
    await expect(run(ids.r1, T0, (tx, ctx) => reviewSkillClaim(tx, ctx, claim.id, ids.r1, true, 'looks good'))).rejects.toMatchObject({ code: 'SKILL_REVIEW_NOT_ALLOWED' }); // credibility < 40
    await makeReviewer();
    expect(await run(ids.rev, T0, (tx, ctx) => reviewSkillClaim(tx, ctx, claim.id, ids.rev, true, 'Saw the certificate.'))).toBe('PENDING'); // specialist needs 2
    expect((await effectiveSkillTier(prisma, ids.pro, 'Translation')).tier).toBe('STANDARD');
  });

  it('demand comes from unique, unexpired, unmatched requests and eligible providers', async () => {
    await offer('pro');
    await request('r1');
    await request('r1'); // duplicate demand from the same person
    await request('r2', addDays(T0, -60)); // expired (older than 45 days)
    let q = await quoteFor(prisma, { providerId: ids.pro, category: 'Translation', durationMinutes: 60, giftBonus: 0, maxCreditBudget: null }, T0);
    expect(q.demand).toMatchObject({ status: 'INSUFFICIENT_DATA', multiplierPct: 100, inputs: { uniqueActiveRequests: 1, availableProviders: 1, excludedDuplicates: 1, excludedExpired: 1 } });
    await request('r2');
    await request('r3');
    q = await quoteFor(prisma, { providerId: ids.pro, category: 'Translation', durationMinutes: 60, giftBonus: 0, maxCreditBudget: null }, T0);
    expect(q.demand).toMatchObject({ status: 'APPLIED', multiplierPct: 120, inputs: { uniqueActiveRequests: 3, availableProviders: 1 } });
  });

  it('stores a price snapshot at acceptance; later demand changes never change an accepted price', async () => {
    await offer('pro');
    await request('r1');
    await request('r2');
    const at = addDays(T0, 3);
    const ex = await agreed(ids.pro, ids.r3, 60, at, { category: 'Translation' });
    const accepted = await prisma.exchange.findUniqueOrThrow({ where: { id: ex.id } });
    expect(accepted).toMatchObject({ creditAmount: 110, demandMultiplierPct: 110 }); // 2 requests / 1 provider
    expect(accepted.priceLockedAt).not.toBeNull();
    // Demand jumps afterwards.
    await request('a');
    await request('rev');
    const now = await quoteFor(prisma, { providerId: ids.pro, category: 'Translation', durationMinutes: 60, giftBonus: 0, maxCreditBudget: null }, T0);
    expect(now.demand.multiplierPct).toBe(130);
    const later = await prisma.exchange.findUniqueOrThrow({ where: { id: ex.id }, include: { reservation: true } });
    expect(later.creditAmount).toBe(110);
    expect(later.reservation!.amount).toBe(110);
    expect((later.priceSnapshot as { serviceCredits: number }).serviceCredits).toBe(110);
    await settleBoth(ex.id, ids.pro, ids.r3, addHours(at, 2));
    expect((await creditSummary(prisma, ids.pro, addHours(at, 3))).posted).toBe(110);
  });

  it('higher prices still respect the −5 available-credit floor', async () => {
    await makeReviewer();
    const claim = await run(ids.pro, T0, (tx, ctx) => createSkillClaim(tx, ctx, ids.pro, { category: 'Translation', tier: 'ADVANCED', evidence: 'Certified translator, five years of experience.' }));
    await run(ids.rev, T0, (tx, ctx) => reviewSkillClaim(tx, ctx, claim.id, ids.rev, true, 'Checked the certificate and samples.'));
    // r1 starts at 0: 2 h × 1.5 = 3 credits → available −3 (allowed)…
    await agreed(ids.pro, ids.r1, 120, addDays(T0, 3), { category: 'Translation' });
    expect((await creditSummary(prisma, ids.r1, T0)).available).toBe(-300);
    // …another 2 h would be −6 at the premium price (it would have been −4 at 1 h = 1 credit).
    const second = await proposed(ids.pro, ids.r1, 120, addDays(T0, 4), { category: 'Translation' });
    await expect(run(ids.pro, T0, (tx, ctx) => acceptExchange(tx, ctx, second.id, ids.pro, 1))).rejects.toMatchObject({ code: 'CREDIT_FLOOR_EXCEEDED', details: { requested: 300, wouldBe: -600 } });
  });

  it('respects the requester’s maximum credit budget', async () => {
    await makeReviewer();
    const claim = await run(ids.pro, T0, (tx, ctx) => createSkillClaim(tx, ctx, ids.pro, { category: 'Translation', tier: 'ADVANCED', evidence: 'Certified translator, five years of experience.' }));
    await run(ids.rev, T0, (tx, ctx) => reviewSkillClaim(tx, ctx, claim.id, ids.rev, true, 'Checked the certificate and samples.'));
    await expect(proposed(ids.pro, ids.r1, 120, addDays(T0, 3), { category: 'Translation', maxCreditBudget: 250 })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    const ok = await proposed(ids.pro, ids.r1, 120, addDays(T0, 3), { category: 'Translation', maxCreditBudget: 300 });
    expect(ok.creditAmount).toBe(300);
  });
});
