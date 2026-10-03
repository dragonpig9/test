import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeStudentEmail } from '@commonhours/shared';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { addDays, addMinutes } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { addDayKey, dayKeyOf, zonedTimeUtc } from '../src/core/timezone';
import { signToken } from '../src/modules/auth/auth.service';
import { evaluateBadges } from '../src/modules/badges/badges.service';
import { planDistribution } from '../src/modules/community-pool/community-pool.rules';
import { runDailyJob } from '../src/modules/daily-job/daily-job.service';
import { systemAccount } from '../src/modules/ledger/ledger.repo';
import { postTransfer } from '../src/modules/ledger/ledger.service';
import { setEmailProviderForTests } from '../src/modules/notifications/email.provider';
import { T0, agreed, community, reset, run, settleBoth } from './fixtures';

/**
 * Section 6: demo mode, monthly Friends activity and badges leave the economy alone.
 * Exact pool rounding (108 credits among 456 → 0.23 each, 104.88 paid, 3.12 retained) is covered in
 * community.rules.test.ts; here the whole daily job runs with a pending-verification demo student.
 */
const app = createApp();
const HK = 'Asia/Hong_Kong';
const hkMorning = (d: Date, n = 0) => zonedTimeUtc(addDayKey(dayKeyOf(d, HK), n), HK, 10);

async function exchange(providerId: string, recipientId: string, when: Date) {
  const e = await agreed(providerId, recipientId, 60, addMinutes(when, -90));
  await settleBoth(e.id, providerId, recipientId, when);
}

afterEach(() => {
  env.demoMode = true;
  setEmailProviderForTests(null);
});

describe('economy is unchanged by demo mode, Friends activity and badges', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await reset();
    ids = await community(['alice', 'ben', 'cat', 'dan']);
  });

  it('a pending-verification demo student takes part in exchanges and the midnight pool exactly like anyone else', async () => {
    const joined = await request(app)
      .post('/api/auth/join/student')
      .send({ displayName: 'Hana', handle: 'hana', password: 'student-password', acceptCommunityTerms: true, student: { university: 'HKU', studentEmail: composeStudentEmail('HKU', 'hana'), currentStudentDeclaration: true } });
    expect(joined.status).toBe(201);
    const hana = joined.body.member.id as string;
    expect(await prisma.member.findUniqueOrThrow({ where: { id: hana } })).toMatchObject({ studentEmailVerifiedAt: null, contactEmailVerifiedAt: null });

    // Fund the pool with a recorded adjustment, then: hana 2 points, ben 1, cat 1 → 3 active → top half = 2 recipients.
    await run(null, T0, async (tx, ctx) => {
      const adj = await systemAccount(tx, 'SYSTEM_ADJUSTMENT');
      const pool = await systemAccount(tx, 'SYSTEM_COMMUNITY_POOL');
      await postTransfer(tx, ctx, { kind: 'ADJUSTMENT', idempotencyKey: 'fund', fromAccountId: adj.id, toAccountId: pool.id, amount: 10_801, explanation: 'test funding', ruleId: 'TEST' });
    });
    const day = addDays(T0, 2);
    await exchange(ids.ben, hana, hkMorning(day));
    await exchange(hana, ids.cat, hkMorning(day));
    expect(await prisma.memberBadge.count({ where: { memberId: hana } })).toBe(1); // First Exchange

    const runDate = addDayKey(dayKeyOf(day, HK), 1);
    const r = await runDailyJob({ runDate, scheduledFor: zonedTimeUtc(runDate, HK) }, { trigger: 'manual' });
    expect(r.run.status).toBe('COMPLETED');
    const plan = planDistribution(10_801, 2); // pool balance before the run
    const d = await prisma.poolDistribution.findUniqueOrThrow({ where: { runDate }, include: { grants: true } });
    expect(d).toMatchObject({ status: 'PAID', activeUserCount: 3, recipientCount: 2, paymentPerRecipient: plan.paymentUnits, totalPaid: plan.totalPaid, remaining: plan.remainingUnits });
    expect(d.grants.map((g) => g.memberId)).toContain(hana); // highest score, pending verification or not

    // No email provider: the reward is an in-app notification and nothing claims an email was sent.
    expect(await prisma.notification.count({ where: { memberId: hana, kind: 'pool.reward' } })).toBe(1);
    expect(await prisma.emailOutbox.count({ where: { status: 'SENT' } })).toBe(0);
  });

  it('awarding badges and reading Friends activity leave pool scoring and the ledger untouched', async () => {
    await exchange(ids.cat, ids.ben, hkMorning(T0, 1));
    await exchange(ids.ben, ids.cat, hkMorning(T0, 2));
    await exchange(ids.ben, ids.alice, hkMorning(T0, 3));
    const ledger = async () => [await prisma.ledgerTransaction.count(), await prisma.creditLot.count(), await prisma.poolDistribution.count()];
    const before = await ledger();
    await request(app).get('/api/friends-activity?year=2026&month=1').set({ authorization: `Bearer ${signToken(ids.ben)}` });
    await prisma.memberBadge.deleteMany();
    await run(null, hkMorning(T0, 4), (tx, ctx) => evaluateBadges(tx, ctx, [ids.ben, ids.cat, ids.alice]));
    expect(await ledger()).toEqual(before);
  });
});
