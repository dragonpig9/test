import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { addDays, addHours } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { DEMO_NOW, seedDemo } from '../src/modules/demo/demo.seed';
import { castVote, openDispute } from '../src/modules/attestation/attestation.service';
import { permissionsOf, scoreOf } from '../src/modules/credibility/credibility.service';
import { acceptExchange, confirmCompletion, proposeExchange } from '../src/modules/exchanges/exchange.service';
import { createInvitation } from '../src/modules/invitations/invitation.service';
import { creditSummary } from '../src/modules/ledger/ledger.service';
import { findPath, loadTrust } from '../src/modules/trust/trust.service';
import { run } from './fixtures';

let ids: Record<string, string>;
beforeAll(async () => {
  ids = await seedDemo(prisma);
});

const terms = (at: Date, minutes: number, extra: object = {}) => ({
  durationMinutes: minutes,
  scheduledAt: at.toISOString(),
  location: '',
  punctualityRequired: false,
  giftBonus: 0,
  cancellationNoticeHours: 12,
  cancellationTerms: 'Free cancellation until 12h before.',
  confirmationDays: 3,
  ...extra,
});

describe('seeded demo reconciles with records', () => {
  it('ledger is balanced, lots match balances, and the trust path is 0.49', async () => {
    expect((await prisma.ledgerEntry.aggregate({ _sum: { amount: true } }))._sum.amount).toBe(0);
    for (const id of Object.values(ids)) {
      const s = await creditSummary(prisma, id, DEMO_NOW);
      expect(s.lots.reduce((a, l) => a + l.remaining, 0)).toBe(Math.max(0, s.posted));
    }
    const p = findPath(await loadTrust(prisma, DEMO_NOW), ids.mei, ids.sam);
    expect(p.members.map((m) => m.handle)).toEqual(['mei', 'alice', 'ben', 'sam']);
    expect(p.strength).toBe(0.49);
    expect(await prisma.dispute.findFirst()).toMatchObject({ status: 'NEEDS_REVIEW' });
  });

  it('Ben cannot accept the 3h repair (credit floor case)', async () => {
    const ex = await prisma.exchange.findFirstOrThrow({ where: { recipientId: ids.ben, status: 'PROPOSED' } });
    await expect(run(ids.ben, DEMO_NOW, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.ben, ex.termsVersion))).rejects.toMatchObject({ code: 'CREDIT_FLOOR_EXCEEDED' });
  });
});

describe('three-minute demo story via real services', () => {
  it('runs steps 1–12 and Mei unlocks inviting', async () => {
    const sam = ids.sam;
    const mei = ids.mei;
    const listing = await prisma.listing.findFirstOrThrow({ where: { ownerId: sam, category: 'Cooking' } });
    const at = addDays(DEMO_NOW, 1);
    const cooking = await run(mei, DEMO_NOW, (tx, ctx) =>
      proposeExchange(tx, ctx, mei, { counterpartyId: sam, myRole: 'recipient', listingId: listing.id, category: 'Cooking', deliverable: '2h Malaysian dinner', ...terms(at, 120) }),
    );
    const tutoring = await run(mei, DEMO_NOW, (tx, ctx) =>
      proposeExchange(tx, ctx, mei, { counterpartyId: sam, myRole: 'provider', category: 'Tutoring', deliverable: '1h maths tutoring', linkedExchangeId: cooking.id, ...terms(at, 60) }),
    );
    const meiBefore = await creditSummary(prisma, mei, DEMO_NOW);
    const samBefore = await creditSummary(prisma, sam, DEMO_NOW);
    await run(sam, DEMO_NOW, (tx, ctx) => acceptExchange(tx, ctx, cooking.id, sam, 1));
    await run(sam, DEMO_NOW, (tx, ctx) => acceptExchange(tx, ctx, tutoring.id, sam, 1));
    expect((await creditSummary(prisma, mei, DEMO_NOW)).available).toBe(meiBefore.available - 200);
    const later = addHours(at, 3);
    for (const ex of [cooking, tutoring]) {
      await run(sam, later, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, sam));
      await run(mei, later, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, mei));
    }
    expect((await creditSummary(prisma, mei, later)).posted - meiBefore.posted).toBe(-100);
    expect((await creditSummary(prisma, sam, later)).posted - samBefore.posted).toBe(100);
    expect(await scoreOf(prisma, mei, later)).toBeLessThan(40);

    // Separate, unsettled exchange with punctuality as an agreed condition.
    const at2 = addDays(DEMO_NOW, 2);
    const translation = await run(mei, later, (tx, ctx) =>
      proposeExchange(tx, ctx, mei, { counterpartyId: sam, myRole: 'provider', category: 'Translation', deliverable: 'Translate a tenancy letter', ...terms(at2, 60, { punctualityRequired: true }) }),
    );
    await run(sam, later, (tx, ctx) => acceptExchange(tx, ctx, translation.id, sam, 1));
    const t3 = addHours(at2, 2);
    const d = await run(sam, t3, (tx, ctx) => openDispute(tx, ctx, sam, { exchangeId: translation.id, condition: 'PUNCTUALITY', claim: 'Mei arrived 40 minutes late; punctuality was agreed.' }));
    expect((await creditSummary(prisma, sam, t3)).disputedOutgoing).toBe(100);
    const first = await prisma.attestorAssignment.findFirstOrThrow({ where: { disputeId: d.id, status: 'ASSIGNED' }, include: { attestor: true } });
    expect(['priya', 'kofi', 'lena', 'tomas']).toContain(first.attestor.handle);
    await run(first.attestorId, t3, (tx, ctx) => castVote(tx, ctx, d.id, first.attestorId, 'UNCLEAR', 'Need more context about the start time.'));
    const panel = await prisma.attestorAssignment.findMany({ where: { disputeId: d.id, stage: 2 } });
    expect(panel).toHaveLength(3);
    for (const a of panel.slice(0, 2)) {
      await run(a.attestorId, t3, (tx, ctx) => castVote(tx, ctx, d.id, a.attestorId, 'CONFIRMED', 'Chat log shows Sam moved the start time; delivered as agreed.'));
    }
    expect(await prisma.dispute.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'RESOLVED', outcome: 'CONFIRMED' });
    const perms = await permissionsOf(prisma, mei, t3);
    expect(perms.find((p) => p.key === 'invite')!.allowed).toBe(true);
    const inv = await run(mei, t3, (tx, ctx) => createInvitation(tx, ctx, mei, { inviteeName: 'Noor', strength: 0.4, liabilityPct: 10, acknowledgeLiability: true }));
    expect(inv.status).toBe('OPEN');
  });
});

describe('HTTP API', () => {
  const app = createApp();
  it('returns stable error codes with module and correlation id', async () => {
    const r = await request(app).get('/api/credits/summary').set('x-correlation-id', 'corr-test-123');
    expect(r.status).toBe(401);
    expect(r.body.error).toMatchObject({ code: 'UNAUTHENTICATED', module: 'auth', correlationId: 'corr-test-123' });
  });
  it('logs in via the demo switcher and never returns password hashes', async () => {
    const s = await request(app).post('/api/demo/switch').send({ handle: 'mei' });
    expect(s.status).toBe(200);
    expect(JSON.stringify(s.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    const me = await request(app).get('/api/auth/me').set('authorization', `Bearer ${s.body.token}`);
    expect(me.body.member.handle).toBe('mei');
    const bad = await request(app).post('/api/exchanges').set('authorization', `Bearer ${s.body.token}`).send({});
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });
});
