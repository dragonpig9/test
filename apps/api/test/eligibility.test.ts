import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { addDays, addHours } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { acceptExchange, approveHomeAccess, proposeExchange, updateTerms } from '../src/modules/exchanges/exchange.service';
import { confirmEmailVerification, requestEmailVerification } from '../src/modules/profiles/profile.verification';
import { createListing } from '../src/modules/services/listing.service';
import { evaluateTaskEligibility } from '../src/modules/task-eligibility/eligibility.rules';
import { scoreOf } from '../src/modules/credibility/credibility.service';
import { T0, agreed, community, proposed, reset, run, settleBoth } from './fixtures';

describe('task eligibility rules (pure)', () => {
  const base = {
    category: 'Other',
    requesterName: 'Owner',
    requesterMinCredibility: null,
    requesterMinRelationshipTrust: null,
    provider: { name: 'P', active: true, score: 30, contact: 'UNVERIFIED' as const },
    relationshipTrust: 0.5,
    ownerApproval: null,
    demoMode: false,
  };
  it('uses the highest of tier, category and requester minimums', () => {
    expect(evaluateTaskEligibility({ ...base, tier: 'STANDARD' })).toMatchObject({ eligible: true, locked: false, requiredCredibility: 0 });
    expect(evaluateTaskEligibility({ ...base, tier: 'RESTRICTED' })).toMatchObject({ locked: false, requiredCredibility: 25 });
    expect(evaluateTaskEligibility({ ...base, tier: 'RESTRICTED', requesterMinCredibility: 40 })).toMatchObject({ locked: true, requiredCredibility: 40 });
    expect(evaluateTaskEligibility({ ...base, tier: 'STANDARD', category: 'Equipment repair', provider: { ...base.provider, score: 20 } })).toMatchObject({ locked: true, requiredCredibility: 25 });
  });
  it('high trust needs score, verified contact and owner approval; approval alone never locks', () => {
    const v = evaluateTaskEligibility({ ...base, tier: 'HIGH_TRUST', provider: { ...base.provider, score: 40, contact: 'VERIFIED' }, ownerApproval: { approved: false } });
    expect(v).toMatchObject({ locked: false, eligible: false });
    expect(v.checks.find((c) => c.key === 'ownerApproval')).toMatchObject({ passed: false, pending: true });
    const unverified = evaluateTaskEligibility({ ...base, tier: 'HIGH_TRUST', provider: { ...base.provider, score: 40 } });
    expect(unverified.locked).toBe(true);
    expect(unverified.howToBecomeEligible.join(' ')).toMatch(/Verify your contact email/);
    // Demo verification counts only in demo mode.
    const demo = { ...base, tier: 'HIGH_TRUST' as const, provider: { ...base.provider, score: 40, contact: 'DEMO_VERIFIED' as const } };
    expect(evaluateTaskEligibility(demo).locked).toBe(true);
    expect(evaluateTaskEligibility({ ...demo, demoMode: true }).locked).toBe(false);
  });
  it('explains the gap and how to become eligible', () => {
    const v = evaluateTaskEligibility({ ...base, tier: 'HIGH_TRUST', provider: { ...base.provider, score: 33 }, requesterMinRelationshipTrust: 0.8 });
    expect(v.requiredCredibility).toBe(35);
    expect(v.checks.find((c) => c.key === 'relationshipTrust')).toMatchObject({ passed: false, required: '≥ 0.8', current: '0.5' });
    expect(v.howToBecomeEligible.join(' ')).toMatch(/by 2 point\(s\) to 35/);
  });
});

describe('task eligibility enforcement (integration)', () => {
  let ids: Record<string, string>;
  const at = addDays(T0, 5);
  beforeEach(async () => {
    await reset();
    ids = await community(['a', 'owner', 'low', 'pro'], [
      ['a', 'owner', 1.0],
      ['a', 'low', 0.4],
      ['a', 'pro', 0.7],
    ]);
    // pro: 0.7 vouch (14) + on-time rate (15) + 2 services (8) = 37.
    for (let i = 0; i < 2; i++) {
      const ex = await agreed(ids.pro, ids.a, 60, addDays(T0, -30 + i));
      await settleBoth(ex.id, ids.pro, ids.a, addHours(addDays(T0, -30 + i), 2));
    }
  });

  it('a low-score member cannot accept a restricted task — not even with a direct API request', async () => {
    expect(await scoreOf(prisma, ids.low, T0)).toBeLessThan(25);
    const ex = await proposed(ids.low, ids.owner, 60, at, { trustTier: 'RESTRICTED' });
    await expect(run(ids.low, T0, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.low, 1))).rejects.toMatchObject({ code: 'TASK_LOCKED' });
    const app = createApp();
    const { body } = await request(app).post('/api/demo/switch').send({ handle: 'low' });
    const r = await request(app).post(`/api/exchanges/${ex.id}/accept`).set('authorization', `Bearer ${body.token}`).send({ termsVersion: 1 });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'TASK_LOCKED', module: 'task-eligibility' });
    expect(r.body.error.details.eligibility).toMatchObject({ tier: 'RESTRICTED', locked: true, requiredCredibility: 25 });
    expect(await prisma.reservation.count({ where: { exchangeId: ex.id } })).toBe(0);
    // Offering to do someone's restricted request is blocked the same way.
    const listing = await run(ids.owner, T0, (tx, ctx) =>
      createListing(tx, ctx, ids.owner, { type: 'REQUEST', title: 'Help me move a sofa', description: 'In my flat, I will be there.', category: 'Other', durationMinutes: 60, locationType: 'IN_PERSON', location: 'Flat', availability: 'Any', requiredSkills: [], trustTier: 'RESTRICTED' }),
    );
    await expect(
      run(ids.low, T0, (tx, ctx) =>
        proposeExchange(tx, ctx, ids.low, { counterpartyId: ids.owner, myRole: 'provider', listingId: listing.id, category: 'Other', deliverable: 'Move sofa', durationMinutes: 60, scheduledAt: at.toISOString(), location: '', punctualityRequired: false, giftBonus: 0, cancellationNoticeHours: 1, cancellationTerms: '', confirmationDays: 3 }),
      ),
    ).rejects.toMatchObject({ code: 'TASK_LOCKED' });
  });

  it('requesters can raise but not lower the minimum', async () => {
    await expect(proposed(ids.pro, ids.owner, 60, at, { trustTier: 'RESTRICTED', minCredibility: 10 })).rejects.toMatchObject({ code: 'REQUIREMENT_TOO_LOW' });
    const raised = await proposed(ids.pro, ids.owner, 60, at, { trustTier: 'RESTRICTED', minCredibility: 50 });
    await expect(run(ids.pro, T0, (tx, ctx) => acceptExchange(tx, ctx, raised.id, ids.pro, 1))).rejects.toMatchObject({ code: 'TASK_LOCKED', details: { eligibility: { requiredCredibility: 50, currentCredibility: 37 } } });
    // The provider cannot quietly lower a requester's requirement through a terms edit.
    await expect(
      run(ids.pro, T0, (tx, ctx) => updateTerms(tx, ctx, raised.id, ids.pro, { deliverable: 'x', durationMinutes: 60, scheduledAt: at.toISOString(), location: '', punctualityRequired: false, giftBonus: 0, cancellationNoticeHours: 1, cancellationTerms: '', confirmationDays: 3, minCredibility: 25 })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an eligible member can accept a high-trust task only with the owner’s explicit approval', async () => {
    const ex = await proposed(ids.pro, ids.owner, 60, at, { trustTier: 'HIGH_TRUST' });
    // Eligible by score (37 ≥ 35) but contact not verified yet.
    await expect(run(ids.pro, T0, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.pro, 1))).rejects.toMatchObject({ code: 'TASK_LOCKED' });
    const r = await run(ids.pro, T0, (tx, ctx) => requestEmailVerification(tx, ctx, ids.pro));
    await run(ids.pro, T0, (tx, ctx) => confirmEmailVerification(tx, ctx, ids.pro, r.code));
    // Score + verification make pro eligible, but the owner has not approved entry: no reservation.
    await expect(run(ids.pro, T0, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.pro, 1))).rejects.toMatchObject({ code: 'TASK_LOCKED' });
    expect(await prisma.reservation.count({ where: { exchangeId: ex.id } })).toBe(0);
    await expect(run(ids.pro, T0, (tx, ctx) => approveHomeAccess(tx, ctx, ex.id, ids.pro, 1))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await run(ids.owner, T0, (tx, ctx) => approveHomeAccess(tx, ctx, ex.id, ids.owner, 1));
    const accepted = await run(ids.pro, T0, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.pro, 1));
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.eligibilitySnapshot).toMatchObject({ eligible: true, tier: 'HIGH_TRUST' });
    expect(await prisma.reservation.count({ where: { exchangeId: ex.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: 'task.home_access_approved', entityId: ex.id } })).toBe(1);
  });

  it('changing the terms clears an earlier home-access approval', async () => {
    const ex = await proposed(ids.pro, ids.owner, 60, at, { trustTier: 'HIGH_TRUST' });
    await run(ids.owner, T0, (tx, ctx) => approveHomeAccess(tx, ctx, ex.id, ids.owner, 1));
    await run(ids.owner, T0, (tx, ctx) =>
      updateTerms(tx, ctx, ex.id, ids.owner, { deliverable: 'Feed the cat twice', durationMinutes: 60, scheduledAt: at.toISOString(), location: '', punctualityRequired: false, giftBonus: 0, cancellationNoticeHours: 1, cancellationTerms: '', confirmationDays: 3 }),
    );
    const r = await run(ids.pro, T0, (tx, ctx) => requestEmailVerification(tx, ctx, ids.pro));
    await run(ids.pro, T0, (tx, ctx) => confirmEmailVerification(tx, ctx, ids.pro, r.code));
    await expect(run(ids.pro, T0, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.pro, 2))).rejects.toMatchObject({ code: 'TASK_LOCKED' });
  });

  it('enforces an optional relationship-trust minimum set by the requester', async () => {
    const ex = await proposed(ids.pro, ids.owner, 60, at, { trustTier: 'STANDARD', minRelationshipTrust: 0.95 });
    await expect(run(ids.pro, T0, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids.pro, 1))).rejects.toMatchObject({ code: 'TASK_LOCKED' });
    const ok = await proposed(ids.pro, ids.owner, 60, addDays(at, 1), { trustTier: 'STANDARD', minRelationshipTrust: 0.5 });
    expect((await run(ids.pro, T0, (tx, ctx) => acceptExchange(tx, ctx, ok.id, ids.pro, 1))).status).toBe('ACCEPTED');
  });
});
