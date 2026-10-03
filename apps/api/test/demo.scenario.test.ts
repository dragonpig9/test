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
import { getMember } from '../src/modules/members/member.repo';
import { quoteFor } from '../src/modules/pricing/pricing.service';
import { listingEligibility } from '../src/modules/task-eligibility/eligibility.service';
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
  it('ledger is balanced, lots match balances, and the strongest trust path is Mei → Alice → Ben → Sam', async () => {
    expect((await prisma.ledgerEntry.aggregate({ _sum: { amount: true } }))._sum.amount).toBe(0);
    for (const id of Object.values(ids)) {
      const s = await creditSummary(prisma, id, DEMO_NOW);
      expect(s.lots.reduce((a, l) => a + l.remaining, 0)).toBe(Math.max(0, s.posted));
    }
    const p = findPath(await loadTrust(prisma, DEMO_NOW), ids.mei, ids.sam);
    expect(p.members.map((m) => m.handle)).toEqual(['mei', 'alice', 'ben', 'sam']);
    // v1 showed 0.7 × 1 × 0.7 = 0.49 (vouches only). Seeded exchanges both members confirmed now add
    // earned relationships (0.2): Mei–Alice and Ben–Sam become 1 − 0.3 × 0.8 = 0.76 → 0.76 × 1 × 0.76.
    expect(p.strength).toBe(0.5776);
    expect(p.steps.map((s) => s.kind)).toEqual(['both', 'both', 'both']);
    expect(await prisma.dispute.findFirst()).toMatchObject({ status: 'NEEDS_REVIEW' });
  });

  it('Ben cannot accept the 3h repair (credit floor case)', async () => {
    const ex = await prisma.exchange.findFirstOrThrow({ where: { recipientId: ids.ben, status: 'PROPOSED' } });
    await expect(run(ids.ben, DEMO_NOW, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.ben, ex.termsVersion))).rejects.toMatchObject({ code: 'CREDIT_FLOOR_EXCEEDED' });
  });
});

describe('three-minute demo story via real services', () => {
  it('runs steps 1–12, unlocks the high-trust task, prices the skilled translation and Mei unlocks inviting', async () => {
    const sam = ids.sam;
    const mei = ids.mei;
    // New demo step: Mei sees Alice's high-trust task locked (credibility 33 < 35).
    const catTask = await prisma.listing.findFirstOrThrow({ where: { ownerId: ids.alice, trustTier: 'HIGH_TRUST' }, include: { owner: true } });
    const lockedBefore = (await listingEligibility(prisma, await getMember(prisma, mei), [catTask], DEMO_NOW)).get(catTask.id)!;
    expect(lockedBefore).toMatchObject({ locked: true, requiredCredibility: 35, currentCredibility: 33 });
    expect(lockedBefore.conditions.join(' ')).toMatch(/explicitly approve/);
    expect(lockedBefore.checks.find((c) => c.key === 'verifiedContact')!.passed).toBe(true); // demo-verified in demo mode
    expect(lockedBefore.checks.find((c) => c.key === 'relationshipTrust')!.passed).toBe(true); // 0.76 ≥ 0.5
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
    // A legitimate service completed → earned trust Mei–Sam created exactly once, eligibility recalculated.
    const updates = await prisma.trustUpdate.findMany({ where: { exchangeId: { in: [cooking.id, tutoring.id] } } });
    expect(updates).toHaveLength(2);
    const byEx = (id: string) => updates.find((u) => u.exchangeId === id)!;
    expect([byEx(cooking.id).previousStrength, byEx(cooking.id).newStrength]).toEqual([0, 0.2]); // new earned edge
    expect([byEx(tutoring.id).previousStrength, byEx(tutoring.id).newStrength]).toEqual([0.2, 0.28]); // 0.2 + 0.1 × 0.8
    expect(updates.every((u) => (u.relationshipTrustAfter ?? 0) >= (u.relationshipTrustBefore ?? 0))).toBe(true);
    const unlocked = (await listingEligibility(prisma, await getMember(prisma, mei), [catTask], later)).get(catTask.id)!;
    expect(unlocked).toMatchObject({ locked: false, currentCredibility: 37 });
    expect(await prisma.notification.count({ where: { memberId: mei, kind: 'tasks.unlocked', dedupeKey: { contains: ':HIGH_TRUST:' } } })).toBe(1);

    // Skilled, high-demand price: 1 h × 1.50 (Advanced, peer-reviewed) × 1.20 (3 requests / 1 provider) = 1.8.
    const quote = await quoteFor(prisma, { providerId: mei, category: 'Translation', durationMinutes: 120, giftBonus: 0, maxCreditBudget: null }, later);
    expect(quote).toMatchObject({ baseCredits: 200, serviceCredits: 360, total: 360 });
    expect(quote.skill).toMatchObject({ tier: 'ADVANCED', multiplierPct: 150, source: 'peer-reviewed' });
    expect(quote.demand).toMatchObject({ multiplierPct: 120, status: 'APPLIED', inputs: { uniqueActiveRequests: 3, availableProviders: 1 } });

    // Separate, unsettled exchange with punctuality as an agreed condition.
    const at2 = addDays(DEMO_NOW, 2);
    const translation = await run(mei, later, (tx, ctx) =>
      proposeExchange(tx, ctx, mei, { counterpartyId: sam, myRole: 'provider', category: 'Translation', deliverable: 'Translate a tenancy letter', ...terms(at2, 60, { punctualityRequired: true }) }),
    );
    await run(sam, later, (tx, ctx) => acceptExchange(tx, ctx, translation.id, sam, 1));
    const t3 = addHours(at2, 2);
    const d = await run(sam, t3, (tx, ctx) => openDispute(tx, ctx, sam, { exchangeId: translation.id, condition: 'PUNCTUALITY', claim: 'Mei arrived 40 minutes late; punctuality was agreed.' }));
    // 1 h at 1.50 × 1.20 = 1.8 credits, locked at acceptance.
    expect((await creditSummary(prisma, sam, t3)).disputedOutgoing).toBe(180);
    const lockedPrice = await prisma.exchange.findUniqueOrThrow({ where: { id: translation.id } });
    expect(lockedPrice).toMatchObject({ creditAmount: 180, skillMultiplierPct: 150, demandMultiplierPct: 120 });
    expect(lockedPrice.priceLockedAt).not.toBeNull();
    const first = await prisma.attestorAssignment.findFirstOrThrow({ where: { disputeId: d.id, status: 'ASSIGNED' }, include: { attestor: true } });
    expect(['priya', 'kofi', 'lena', 'tomas']).toContain(first.attestor.handle);
    // Jury snapshot: the selected juror has the lowest closeness among eligible candidates.
    const sel = await prisma.attestorSelection.findFirstOrThrow({ where: { disputeId: d.id }, orderBy: { createdAt: 'asc' } });
    const rows = sel.candidates as { memberId: string; eligible: boolean; closeness: { value: number } | null; selectionReason: string | null }[];
    const eligibleRows = rows.filter((r) => r.eligible);
    const chosen = rows.find((r) => r.memberId === first.attestorId)!;
    expect(sel.method).toBe('lowest-closeness-v2');
    expect(chosen.closeness!.value).toBe(Math.min(...eligibleRows.map((r) => r.closeness!.value)));
    expect(chosen.selectionReason).toMatch(/^Selected because this member meets the reliability requirement and has limited connections to either party/);
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
