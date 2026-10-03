import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { addHours } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { signToken } from '../src/modules/auth/auth.service';
import { checkDemoFixtures, expiryView, repairDemoFixtures } from '../src/modules/demo/demo.fixtures';
import { demoReadiness, demoReadyForJobs, markDemoStatus } from '../src/modules/demo/demo.readiness';
import { DEMO_NOW, seedDemo } from '../src/modules/demo/demo.seed';
import { acceptExchange, confirmCompletion, proposeExchange } from '../src/modules/exchanges/exchange.service';
import { runCreditExpiry } from '../src/modules/expiry/expiry.service';
import { run } from './fixtures';

const app = createApp();
let ids: Record<string, string>;
beforeAll(async () => {
  ids = await seedDemo(prisma);
});

const state = (key: string, checks: Awaited<ReturnType<typeof checkDemoFixtures>>) => checks.find((c) => c.key === key)!;

describe('Demo readiness', () => {
  it('is READY with a seed version only after seeding and fixture checks', async () => {
    const r = await demoReadiness(prisma);
    expect(r.status).toBe('READY');
    expect(r.seedVersion).toBeTruthy();
    const checks = await checkDemoFixtures(prisma, DEMO_NOW);
    expect(checks.map((c) => [c.key, c.state])).toEqual([
      ['home', 'ready'],
      ['skills', 'ready'],
      ['floor', 'ready'],
      ['jury', 'ready'],
      ['expiry', 'ready'],
    ]);
    const w = (await request(app).get('/api/demo/walkthrough')).body;
    expect(w.seedVersion).toBe(r.seedVersion);
  });

  it('never serves partial data or runs actions while preparing, and READY again gives a new version', async () => {
    const before = (await demoReadiness(prisma)).seedVersion;
    const seeding = seedDemo(prisma);
    const seen: number[] = [];
    let done = false;
    void seeding.finally(() => (done = true));
    while (!done) {
      const res = await request(app).get('/api/demo/walkthrough');
      seen.push(res.status);
      if (res.status === 200) {
        // Only ever the completed community: every edge case present.
        expect(Object.values(res.body.edgeCases.status).every((c) => (c as { state: string }).state === 'ready')).toBe(true);
      } else {
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('DEMO_PREPARING');
        const sw = await request(app).post('/api/demo/switch').send({ handle: 'mei' });
        expect([503]).toContain(sw.status);
        expect(await demoReadyForJobs(prisma)).toBe(false);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    ids = await seeding;
    expect(seen).toContain(503);
    const after = await demoReadiness(prisma);
    expect(after.status).toBe('READY');
    expect(after.seedVersion).not.toBe(before);
    expect((await request(app).get('/api/demo/walkthrough')).status).toBe(200);
  }, 120_000);

  it('reports FAILED with the reason and blocks actions until a reset', async () => {
    await markDemoStatus(prisma, 'FAILED', 'Demo fixture check failed: test.');
    const w = await request(app).get('/api/demo/walkthrough');
    expect(w.status).toBe(503);
    expect(w.body.error.code).toBe('DEMO_FAILED');
    expect((await request(app).get('/api/demo/readiness')).body).toMatchObject({ status: 'FAILED', detail: 'Demo fixture check failed: test.' });
    expect((await request(app).post('/api/demo/switch').send({ handle: 'mei' })).status).toBe(503);
    await markDemoStatus(prisma, 'READY', null);
    expect((await request(app).post('/api/demo/switch').send({ handle: 'mei' })).status).toBe(200);
  });
});

describe('Edge-case records', () => {
  it('skill review: Mei’s approved Translation claim, a qualifying conflict-free reviewer and the price effect', async () => {
    const w = (await request(app).get('/api/demo/walkthrough')).body;
    expect(w.edgeCases.meiSkillClaims[0]).toMatchObject({ category: 'Translation', tier: 'ADVANCED', status: 'APPROVED' });
    expect(w.edgeCases.skillReviews).toHaveLength(1);
    const r = w.edgeCases.skillReviews[0];
    expect(r.reviewer.handle).toBe('priya');
    expect(r).toMatchObject({ approve: true, conflictDeclared: false, requiredCredibility: 40 });
    expect(r.reviewerCredibilityAtReview).toBeGreaterThanOrEqual(40);
    expect(w.trust.translationOffer.priceEstimate.skill).toMatchObject({ tier: 'ADVANCED', multiplierPct: 150, source: 'peer-reviewed' });
  });

  it('credit floor: −3 − 3 = −6 is below −5, and the rejected acceptance creates no reservation or settlement', async () => {
    const w = (await request(app).get('/api/demo/walkthrough')).body;
    expect(w.edgeCases.floor).toMatchObject({ exchangeStatus: 'PROPOSED', cost: 300, availableNow: -300, availableAfter: -600, floor: -500, wouldBreach: true, reservations: 0 });
    const counts = async () => ({ reservations: await prisma.reservation.count(), ledger: await prisma.ledgerTransaction.count() });
    const before = await counts();
    const ex = await prisma.exchange.findUniqueOrThrow({ where: { id: w.edgeCases.floorExchangeId } });
    const res = await request(app).post(`/api/exchanges/${ex.id}/accept`).set('authorization', `Bearer ${signToken(ids.ben)}`).send({ termsVersion: ex.termsVersion });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CREDIT_FLOOR_EXCEEDED');
    expect(await counts()).toEqual(before);
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe('PROPOSED');
  });

  it('too few jurors: the kettle dispute with its UNCLEAR vote is in NEEDS_REVIEW with frozen credits', async () => {
    const w = (await request(app).get('/api/demo/walkthrough')).body;
    const d = await prisma.dispute.findUniqueOrThrow({ where: { id: w.edgeCases.kettleDisputeId }, include: { assignments: true, exchange: { include: { reservation: true } } } });
    expect(d.status).toBe('NEEDS_REVIEW');
    expect(d.assignments.map((a) => a.vote)).toContain('UNCLEAR');
    expect(d.exchange.reservation?.status).toBe('FROZEN');
  });

  it('expiry: processed lots are attributed to the recorded expiry transaction, with a future lot and the real next date', async () => {
    const v = await expiryView(prisma, ids.tomas, DEMO_NOW);
    expect(v.attributionExact).toBe(true);
    expect(v.lots.map((l) => l.state)).toEqual(['expired', 'expired', 'expired', 'active', 'active']);
    expect(v.transactions).toHaveLength(1);
    expect(v.transactions[0]).toMatchObject({ memberDebit: -300, poolCredit: 300 });
    expect(v.lots.filter((l) => l.state === 'expired').every((l) => l.expiryTransactionIds[0] === v.transactions[0].id)).toBe(true);
    expect(v.nextExpiryAt).toBe('2026-10-05T13:00:00.000Z');
    expect(v.dueNow).toBe(0);
    // Exactly once: running the sweep again at the same time posts nothing.
    const expiries = () => prisma.ledgerTransaction.count({ where: { kind: 'EXPIRY' } });
    const n = await expiries();
    await run(null, DEMO_NOW, (tx, ctx) => runCreditExpiry(tx, ctx));
    expect(await expiries()).toBe(n);
    // Past its date but not processed yet is "due", never "expired → pool".
    const later = await expiryView(prisma, ids.tomas, new Date('2026-10-06T00:00:00Z'));
    expect(later.lots[3]).toMatchObject({ state: 'due', expiredAmount: 0 });
    expect(later.dueNow).toBe(100);
  });

  it('repairs a genuinely missing skill claim once, through the service functions', async () => {
    const claim = await prisma.skillClaim.findFirstOrThrow({ where: { memberId: ids.mei } });
    await prisma.skillReview.deleteMany({ where: { claimId: claim.id } });
    await prisma.skillClaim.delete({ where: { id: claim.id } });
    expect(state('skills', await checkDemoFixtures(prisma, DEMO_NOW)).state).toBe('missing');
    const r = await repairDemoFixtures(prisma, DEMO_NOW);
    expect(r.repaired).toEqual(['skills']);
    expect(state('skills', r.checks).state).toBe('ready');
    expect((await repairDemoFixtures(prisma, DEMO_NOW)).repaired).toEqual([]);
    expect(await prisma.skillClaim.count({ where: { memberId: ids.mei } })).toBe(1);
  });

  it('does not claim a floor rejection once Ben’s balance would allow acceptance', async () => {
    // Ben earns one credit: −2 − 3 = −5 is exactly the floor, which is allowed.
    const at = addHours(DEMO_NOW, 2);
    const ex = await run(ids.alice, DEMO_NOW, (tx, ctx) =>
      proposeExchange(tx, ctx, ids.alice, {
        counterpartyId: ids.ben,
        myRole: 'recipient',
        category: 'Cooking',
        deliverable: 'Soup',
        durationMinutes: 60,
        scheduledAt: at.toISOString(),
        location: '',
        punctualityRequired: false,
        giftBonus: 0,
        cancellationNoticeHours: 1,
        cancellationTerms: 'Free.',
        confirmationDays: 3,
      }),
    );
    await run(ids.ben, DEMO_NOW, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.ben, ex.termsVersion));
    await run(ids.ben, addHours(at, 2), (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.ben));
    await run(ids.alice, addHours(at, 2), (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.alice));
    const floor = state('floor', await checkDemoFixtures(prisma, DEMO_NOW));
    expect(floor.state).toBe('changed');
    expect(floor.detail).toContain('acceptance would be allowed');
  });
});
