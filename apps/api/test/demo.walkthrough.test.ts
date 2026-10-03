import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { addHours } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { acceptExchange, confirmCompletion, declineOrWithdraw, proposeExchange } from '../src/modules/exchanges/exchange.service';
import { DEMO_NOW, seedDemo } from '../src/modules/demo/demo.seed';
import { run } from './fixtures';

const app = createApp();
let ids: Record<string, string>;
beforeAll(async () => {
  ids = await seedDemo(prisma);
});

const counts = async () => ({
  audit: await prisma.auditEvent.count(),
  ledger: await prisma.ledgerEntry.count(),
  exchanges: await prisma.exchange.count(),
  notifications: await prisma.notification.count(),
  members: await prisma.member.count(),
});

describe('Simple demo walkthrough (GET /api/demo/walkthrough)', () => {
  it('is read-only and public in demo mode: opening it repeatedly changes nothing', async () => {
    const before = await counts();
    for (let i = 0; i < 3; i++) expect((await request(app).get('/api/demo/walkthrough')).status).toBe(200);
    expect(await counts()).toEqual(before);
  });

  it('reports live values from records, never private data', async () => {
    const r = await request(app).get('/api/demo/walkthrough');
    const w = r.body;
    expect(w.trust.path.members.map((m: { handle: string }) => m.handle)).toEqual(['mei', 'alice', 'ben', 'sam']);
    expect(w.trust.path.strength).toBe(0.5776);
    expect(w.trust.aliceVouch).toMatchObject({ edge: { strength: 0.7, liabilityPct: 10, maxPenaltyPoints: 2 }, liabilityMultiplier: 1, backedStrength: 0.7 });
    expect(w.trust.catTask.eligibility).toMatchObject({ locked: true, requiredCredibility: 35, currentCredibility: 33 });
    expect(w.chapters.map((c: { steps: unknown[] }) => c.steps.length)).toEqual([4, 4, 1, 3, 3]);
    expect(w.chapters.every((c: { done: boolean }) => !c.done)).toBe(true);
    expect(w.edgeCases.kettleDisputeId).toBeTruthy();
    expect(w.edgeCases.floorExchangeId).toBeTruthy();
    const json = JSON.stringify(w);
    expect(json).not.toMatch(/Allotment Lane|passwordHash|verify your contact email/);
  });

  it('separates the two settled exchanges and reads before/after from records', async () => {
    const listing = await prisma.listing.findFirstOrThrow({ where: { ownerId: ids.sam, category: 'Cooking' } });
    const at = addHours(DEMO_NOW, 2);
    const terms = { scheduledAt: at.toISOString(), location: '', punctualityRequired: false, giftBonus: 0, cancellationNoticeHours: 1, cancellationTerms: 'Free.', confirmationDays: 3 };
    // A proposal Sam declined is skipped, so it never blocks the story.
    const declined = await run(ids.mei, DEMO_NOW, (tx, ctx) =>
      proposeExchange(tx, ctx, ids.mei, { counterpartyId: ids.sam, myRole: 'recipient', listingId: listing.id, category: 'Cooking', deliverable: 'declined dinner', durationMinutes: 120, trustTier: 'RESTRICTED', ...terms }),
    );
    await run(ids.sam, DEMO_NOW, (tx, ctx) => declineOrWithdraw(tx, ctx, declined.id, ids.sam));
    expect((await request(app).get('/api/demo/walkthrough')).body.story.cooking).toBeNull();
    const cooking = await run(ids.mei, DEMO_NOW, (tx, ctx) =>
      proposeExchange(tx, ctx, ids.mei, { counterpartyId: ids.sam, myRole: 'recipient', listingId: listing.id, category: 'Cooking', deliverable: '2h dinner', durationMinutes: 120, trustTier: 'RESTRICTED', ...terms }),
    );
    const tutoring = await run(ids.mei, DEMO_NOW, (tx, ctx) =>
      proposeExchange(tx, ctx, ids.mei, { counterpartyId: ids.sam, myRole: 'provider', category: 'Tutoring', deliverable: '1h tutoring', durationMinutes: 60, linkedExchangeId: cooking.id, ...terms }),
    );
    for (const ex of [cooking, tutoring]) await run(ids.sam, DEMO_NOW, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.sam, 1));
    const later = addHours(at, 3);
    for (const ex of [cooking, tutoring]) {
      await run(ids.sam, later, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.sam));
      await run(ids.mei, later, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.mei));
    }
    const w = (await request(app).get('/api/demo/walkthrough')).body;
    const [mei, sam] = w.story.comparison.rows;
    expect(w.story.comparison.settled).toBe(2);
    expect(mei.serviceTransfers.map((t: { amount: number }) => t.amount).sort()).toEqual([-200, 100]);
    expect(sam.serviceTransfers.map((t: { amount: number }) => t.amount).sort()).toEqual([-100, 200]);
    expect(mei.postedNow - mei.postedBefore).toBe(-100);
    expect([mei.credibilityBefore, mei.credibilityAfter]).toEqual([33, 37]);
    expect(w.story.comparison.earned).toMatchObject({ before: 0, after: 0.28 });
    expect(w.chapters[1].steps.slice(0, 3).every((s: { done: boolean }) => s.done)).toBe(true);
  });
});
