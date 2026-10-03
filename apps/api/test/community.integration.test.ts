import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { addDays, addMinutes, DAY_MS } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { addDayKey, dayKeyOf, zonedTimeUtc } from '../src/core/timezone';
import { activityScores } from '../src/modules/activity/activity.service';
import { friendsActivity } from '../src/modules/friends-activity/friends-activity.service';
import { declareConflict } from '../src/modules/attestation/attestation.service';
import { signToken } from '../src/modules/auth/auth.service';
import { runDailyJob } from '../src/modules/daily-job/daily-job.service';
import { runCreditExpiry } from '../src/modules/expiry/expiry.service';
import { postedBalance, systemAccount } from '../src/modules/ledger/ledger.repo';
import { creditSummary, postTransfer } from '../src/modules/ledger/ledger.service';
import { sendNegativeBalanceReminders, syncNegativePeriods } from '../src/modules/negative-balance/negative-balance.service';
import { setEmailProviderForTests } from '../src/modules/notifications/email.provider';
import { assertStudentEmailMatches } from '../src/modules/student/student.rules';
import { setStudentDetails } from '../src/modules/student/student.service';
import { confirmStudentEmailCode, requestStudentEmailCode } from '../src/modules/student/student.verification';
import { T0, agreed, community, reset, run, settleBoth } from './fixtures';

const app = createApp();
const HK = 'Asia/Hong_Kong';
const auth = (id: string) => ({ authorization: `Bearer ${signToken(id)}` });
/** 10:00 Hong Kong time on the local day containing `d` + n days. */
const hkMorning = (d: Date, n = 0) => zonedTimeUtc(addDayKey(dayKeyOf(d, HK), n), HK, 10);

/** Puts `units` into the Community Credit Pool through a recorded, balanced adjustment. */
async function fundPool(units: number, when = T0) {
  await run(null, when, async (tx, ctx) => {
    const adj = await systemAccount(tx, 'SYSTEM_ADJUSTMENT');
    const pool = await systemAccount(tx, 'SYSTEM_COMMUNITY_POOL');
    await postTransfer(tx, ctx, { kind: 'ADJUSTMENT', idempotencyKey: `fund:${units}:${when.toISOString()}`, fromAccountId: adj.id, toAccountId: pool.id, amount: units, explanation: 'test funding', ruleId: 'TEST' });
  });
}
const pool = async () => postedBalance(prisma, (await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'SYSTEM_COMMUNITY_POOL' } })).id);
const posted = async (id: string) => (await creditSummary(prisma, id, T0)).posted;
/** A settled exchange: provider gives `minutes` to recipient, settled at `when`. */
async function exchange(providerId: string, recipientId: string, minutes: number, when: Date) {
  const ex = await agreed(providerId, recipientId, minutes, addMinutes(when, -90));
  await settleBoth(ex.id, providerId, recipientId, when);
  return ex;
}
const dueFor = (runDate: string) => ({ runDate, scheduledFor: zonedTimeUtc(runDate, HK) });

afterEach(() => setEmailProviderForTests(null));

describe('student registration and university email verification', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await reset();
    ids = await community(['alice', 'mei']);
  });

  it('backend rejects university/domain mismatches (HTTP and service)', async () => {
    const r = await request(app).put('/api/students/me').set(auth(ids.mei)).send({ university: 'HKU', studentEmail: 'mei@link.cuhk.edu.hk', currentStudentDeclaration: true });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/@connect.hku.hk/);
    const dup = await request(app).put('/api/students/me').set(auth(ids.mei)).send({ university: 'HKU', studentEmail: 'mei@connect.hku.hk@connect.hku.hk', currentStudentDeclaration: true });
    expect(dup.status).toBe(400);
    expect(() => assertStudentEmailMatches('Lingnan', 'mei@ln.hk.evil.com')).toThrow(expect.objectContaining({ code: 'UNIVERSITY_DOMAIN_MISMATCH' }));
    const ok = await request(app).put('/api/students/me').set(auth(ids.mei)).send({ university: 'HKU', studentEmail: 'Mei@connect.hku.hk', currentStudentDeclaration: true });
    expect(ok.status).toBe(200);
    expect(ok.body.student).toMatchObject({ accountType: 'STUDENT', studentEmail: 'mei@connect.hku.hk', emailVerification: 'PENDING', university: { code: 'HKU' } });
  });

  it('verifies with an expiring single-use code; changing the email requires verification again', async () => {
    setEmailProviderForTests({ name: 'fake', send: async () => ({ messageId: 'x' }) });
    await run(ids.mei, T0, (tx, ctx) => setStudentDetails(tx, ctx, ids.mei, { university: 'CityU', studentEmail: 'meichen3@my.cityu.edu.hk', currentStudentDeclaration: true }));
    const sent = await run(ids.mei, T0, (tx, ctx) => requestStudentEmailCode(tx, ctx, ids.mei));
    expect(sent.delivery).toBe('smtp');
    // Wrong code, then expired code.
    expect((await run(ids.mei, T0, (tx, ctx) => confirmStudentEmailCode(tx, ctx, ids.mei, '000000'.replace(/./g, (c, i) => (sent.code[i] === '0' ? '1' : '0'))))).verified).toBe(false);
    await expect(run(ids.mei, addMinutes(T0, 31), (tx, ctx) => confirmStudentEmailCode(tx, ctx, ids.mei, sent.code))).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    // Fresh code within 30 minutes works once.
    const again = await run(ids.mei, T0, (tx, ctx) => requestStudentEmailCode(tx, ctx, ids.mei));
    expect(await run(ids.mei, T0, (tx, ctx) => confirmStudentEmailCode(tx, ctx, ids.mei, again.code))).toMatchObject({ verified: true, method: 'email-code' });
    await expect(run(ids.mei, T0, (tx, ctx) => confirmStudentEmailCode(tx, ctx, ids.mei, again.code))).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    let me = await request(app).get('/api/students/me').set(auth(ids.mei));
    expect(me.body.student.emailVerification).toBe('VERIFIED');
    const profile = await request(app).get(`/api/profiles/${ids.mei}`).set(auth(ids.alice));
    expect(profile.body.profile.member).toMatchObject({ university: 'CityU', universityEmailVerified: true });
    expect(JSON.stringify(profile.body)).not.toContain('meichen3@'); // the address stays private

    // Same details again: verification kept (declaration renewed). New university: verification reset.
    await run(ids.mei, T0, (tx, ctx) => setStudentDetails(tx, ctx, ids.mei, { university: 'CityU', studentEmail: 'meichen3@my.cityu.edu.hk', currentStudentDeclaration: true }));
    expect((await prisma.member.findUniqueOrThrow({ where: { id: ids.mei } })).studentEmailVerifiedAt).not.toBeNull();
    const pending = await run(ids.mei, T0, async (tx, ctx) => {
      await tx.member.update({ where: { id: ids.mei }, data: { studentEmailVerifiedAt: null } }); // make an outstanding code
      return requestStudentEmailCode(tx, ctx, ids.mei);
    });
    const changed = await request(app).put('/api/students/me').set(auth(ids.mei)).send({ university: 'HKU', studentEmail: 'meichen3@connect.hku.hk', currentStudentDeclaration: true });
    expect(changed.body).toMatchObject({ verificationReset: true, student: { emailVerification: 'PENDING' } });
    // The code sent to the previous address can no longer verify the new one.
    await expect(run(ids.mei, T0, (tx, ctx) => confirmStudentEmailCode(tx, ctx, ids.mei, pending.code))).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    me = await request(app).get('/api/students/me').set(auth(ids.mei));
    expect(me.body.student.emailVerification).toBe('PENDING');
  });

  it('development preview codes are never labelled "verified"; contact and student codes are separate', async () => {
    await run(ids.mei, T0, (tx, ctx) => setStudentDetails(tx, ctx, ids.mei, { university: 'HKU', studentEmail: 'mei@connect.hku.hk', currentStudentDeclaration: true }));
    const sent = await run(ids.mei, T0, (tx, ctx) => requestStudentEmailCode(tx, ctx, ids.mei));
    expect(sent.delivery).toBe('preview'); // NODE_ENV=test + demo mode → development shortcut
    await run(ids.mei, T0, (tx, ctx) => confirmStudentEmailCode(tx, ctx, ids.mei, sent.code));
    const me = await request(app).get('/api/students/me').set(auth(ids.mei));
    expect(me.body.student.emailVerification).toBe('DEMO_VERIFIED');
    expect((await request(app).get(`/api/profiles/${ids.mei}`).set(auth(ids.alice))).body.profile.member.universityEmailVerified).toBe(false);
    expect(await prisma.emailVerification.count({ where: { memberId: ids.mei, purpose: 'contact' } })).toBe(0);
  });

  it('“Register as a student” at join: university email becomes the login email and must match', async () => {
    const inv = await prisma.invitation.create({ data: { code: 'STUDENT1', inviterId: ids.alice, inviteeName: 'Ka Yan', strength: 0.7, liabilityPct: 20, termsVersion: 'test', createdAt: T0, expiresAt: addDays(T0, 14) } });
    const base = { code: inv.code, displayName: 'Ka Yan', handle: 'kayan', password: 'long-enough-pw', acceptCommunityTerms: true, acceptVouchTerms: true };
    const bad = await request(app).post('/api/auth/join').send({ ...base, email: 'kayan@ln.hk', student: { university: 'HKBU', studentEmail: 'kayan@ln.hk', currentStudentDeclaration: true } });
    expect(bad.status).toBe(400);
    const r = await request(app).post('/api/auth/join').send({ ...base, email: 'kayan@life.hkbu.edu.hk', student: { university: 'HKBU', studentEmail: 'kayan@life.hkbu.edu.hk', currentStudentDeclaration: true } });
    expect(r.status).toBe(201);
    // Demo mode (the test default): no code is sent and nothing is verified; the account is admitted as a demo student.
    expect(r.body).toMatchObject({ demoAdmitted: true, studentVerification: null });
    const m = await prisma.member.findUniqueOrThrow({ where: { handle: 'kayan' } });
    expect(m).toMatchObject({ accountType: 'STUDENT', university: 'HKBU', studentEmail: 'kayan@life.hkbu.edu.hk', studentEmailVerifiedAt: null });
    expect(m.studentDeclaredAt).not.toBeNull();
    expect(await prisma.emailOutbox.count({ where: { memberId: m.id } })).toBe(0);

    // Normal mode: the university email code is sent right after joining.
    env.demoMode = false;
    try {
      const inv2 = await prisma.invitation.create({ data: { code: 'STUDENT2', inviterId: ids.alice, inviteeName: 'Wing', strength: 0.7, liabilityPct: 20, termsVersion: 'test', createdAt: T0, expiresAt: addDays(T0, 14) } });
      const r2 = await request(app).post('/api/auth/join').send({ ...base, code: inv2.code, handle: 'wing', email: 'wing@life.hkbu.edu.hk', student: { university: 'HKBU', studentEmail: 'wing@life.hkbu.edu.hk', currentStudentDeclaration: true } });
      expect(r2.status).toBe(201);
      expect(r2.body.studentVerification).toMatchObject({ sentTo: 'wing@life.hkbu.edu.hk' });
    } finally {
      env.demoMode = true;
    }
  });
});

describe('community credit pool and the daily job', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await reset();
    ids = await community(['alice', 'ben', 'cat', 'dan', 'eve']);
  });

  it('expires credits into the pool once, then distributes exactly to the top half of active members', async () => {
    // Ben earned 1 credit long ago → it expires into the pool. Re-running expiry changes nothing.
    await exchange(ids.ben, ids.alice, 60, T0);
    const later = addMonths13(T0);
    await run(null, later, (tx, ctx) => runCreditExpiry(tx, ctx));
    await run(null, later, (tx, ctx) => runCreditExpiry(tx, ctx));
    expect(await pool()).toBe(100);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'EXPIRY' } })).toBe(1);
    await fundPool(901, later);

    // Activity in the week before the run: cat 2 points, dan 1, eve 1 → 3 active → ceil(3/2) = 2 recipients.
    const day = addDays(later, 2);
    await exchange(ids.cat, ids.dan, 60, hkMorning(day));
    await exchange(ids.cat, ids.eve, 60, hkMorning(day));
    const runDate = addDayKey(dayKeyOf(day, HK), 1);
    const before = { cat: await posted(ids.cat), dan: await posted(ids.dan), eve: await posted(ids.eve) };
    const r = await runDailyJob(dueFor(runDate), { trigger: 'manual' });
    expect(r.run.status).toBe('COMPLETED');

    const d = await prisma.poolDistribution.findUniqueOrThrow({ where: { runDate }, include: { grants: true } });
    expect(d).toMatchObject({ status: 'PAID', poolBefore: 1001, activeUserCount: 3, recipientCount: 2, paymentPerRecipient: 500, totalPaid: 1000, remaining: 1 });
    expect(await pool()).toBe(1);
    expect(d.grants.map((g) => g.memberId)).toContain(ids.cat); // highest score always selected
    const tieWinner = d.grants.find((g) => g.memberId !== ids.cat)!.memberId;
    expect([ids.dan, ids.eve]).toContain(tieWinner);
    expect(await posted(ids.cat)).toBe(before.cat + 500);
    expect(await posted(tieWinner)).toBe(before[tieWinner === ids.dan ? 'dan' : 'eve'] + 500);
    // Reward credits are a normal dated lot (they expire like any received credits).
    const lot = await prisma.creditLot.findFirstOrThrow({ where: { memberId: ids.cat, sourceTransactionId: d.grants.find((g) => g.memberId === ids.cat)!.ledgerTransactionId } });
    expect(lot.expiresAt.getTime()).toBeGreaterThan(lot.earnedAt.getTime());
    expect(await prisma.notification.count({ where: { kind: 'pool.reward' } })).toBe(2);

    // Retries never pay twice: completed run → no-op; even a FAILED run that re-runs every step pays nobody again.
    expect((await runDailyJob(dueFor(runDate), { trigger: 'manual' })).ran).toBe(false);
    await prisma.dailyJobRun.update({ where: { runDate }, data: { status: 'FAILED' } });
    const retry = await runDailyJob(dueFor(runDate), { trigger: 'manual' });
    expect(retry).toMatchObject({ ran: true, run: { status: 'COMPLETED', attempts: 2 } });
    expect(await prisma.poolGrant.count()).toBe(2);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'POOL_DISTRIBUTION' } })).toBe(2);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'EXPIRY' } })).toBe(1);
    expect(await prisma.notification.count({ where: { kind: 'pool.reward' } })).toBe(2);
    // Pool rewards earn no activity points (pool window) and are not "credits earned" in Friends activity.
    const scores = await activityScores(prisma, dayKeyOf(hkMorning(day, 1), HK));
    expect(scores.scores.get(ids.cat)!.points).toBe(2);
    const { year, month } = { year: Number(runDate.slice(0, 4)), month: Number(runDate.slice(5, 7)) };
    const fa = await friendsActivity(prisma, ids.cat, year, month, hkMorning(day, 1));
    expect(fa.entries.find((e) => e.isMe)).toMatchObject({ points: 2, creditsEarned: 200, creditsSpent: 0 });

    // The view shows balance, last distribution and the retained remainder.
    const v = await request(app).get('/api/community-pool').set(auth(ids.cat));
    expect(v.body).toMatchObject({ balance: 1, lastDistribution: { recipientCount: 2, paymentPerRecipient: 500, remaining: 1 }, myLastGrant: { amount: 500 } });
  });

  it('the same date always picks the same tie winner; no active members retains the pool', async () => {
    await fundPool(1000);
    const runDate = addDayKey(dayKeyOf(T0, HK), 1);
    expect((await runDailyJob(dueFor(runDate), { trigger: 'manual' })).run.status).toBe('COMPLETED');
    expect(await prisma.poolDistribution.findUniqueOrThrow({ where: { runDate } })).toMatchObject({ status: 'RETAINED_NO_ACTIVE_USERS', recipientCount: 0, remaining: 1000 });
    expect(await pool()).toBe(1000);

    // Two members tied on 1 point → 1 recipient; the stored ranking replays identically.
    await exchange(ids.dan, ids.eve, 60, hkMorning(T0, 3));
    const runDate2 = addDayKey(dayKeyOf(T0, HK), 4);
    await runDailyJob(dueFor(runDate2), { trigger: 'manual' });
    const d = await prisma.poolDistribution.findUniqueOrThrow({ where: { runDate: runDate2 }, include: { grants: true } });
    expect(d).toMatchObject({ status: 'PAID', activeUserCount: 2, recipientCount: 1, paymentPerRecipient: 1000, remaining: 0 });
    const { rankAndSelect } = await import('../src/modules/community-pool/community-pool.rules');
    const replay = rankAndSelect([{ memberId: ids.dan, points: 1 }, { memberId: ids.eve, points: 1 }], 1, `community-pool:${runDate2}`);
    expect(d.grants[0].memberId).toBe(replay[0].memberId);
  });

  it('two workers running the same date concurrently pay each recipient once', async () => {
    await fundPool(1000);
    await exchange(ids.dan, ids.eve, 60, hkMorning(T0, 3));
    await exchange(ids.ben, ids.cat, 60, hkMorning(T0, 3));
    const runDate = addDayKey(dayKeyOf(T0, HK), 4);
    await Promise.all([runDailyJob(dueFor(runDate), { trigger: 'scheduler' }), runDailyJob(dueFor(runDate), { trigger: 'cli' })]);
    expect(await prisma.poolDistribution.count({ where: { runDate } })).toBe(1);
    expect(await prisma.poolGrant.count()).toBe(2);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'POOL_DISTRIBUTION' } })).toBe(2);
    expect(await pool()).toBe(0);
  });

  it('demo controls: clock advance runs every crossed 00:00 once; "Run daily job" is idempotent', async () => {
    const h = auth(ids.alice);
    const adv = await request(app).post('/api/demo/clock/advance').set(h).send({ days: 3 });
    expect(adv.status).toBe(200);
    expect(adv.body.dailyJobs.map((r: { status: string }) => r.status)).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED']);
    const first = await request(app).post('/api/demo/daily-job/run').set(h).send({});
    expect(first.body).toMatchObject({ ran: false, run: { status: 'COMPLETED', trigger: 'clock-advance' } });
    const next = await request(app).post('/api/demo/clock/next-daily-run').set(h).send({});
    expect(next.body.dailyJobs).toHaveLength(1);
    expect((await request(app).get('/api/daily-job/runs').set(h)).body.runs).toHaveLength(4);
  });

  it('a pool too small to pay 0.01 each is retained for later', async () => {
    await fundPool(1);
    await exchange(ids.dan, ids.eve, 60, hkMorning(T0, 3));
    await exchange(ids.ben, ids.cat, 60, hkMorning(T0, 3));
    const runDate = addDayKey(dayKeyOf(T0, HK), 4);
    await runDailyJob(dueFor(runDate), { trigger: 'manual' });
    expect(await prisma.poolDistribution.findUniqueOrThrow({ where: { runDate } })).toMatchObject({ status: 'RETAINED_TOO_SMALL', recipientCount: 2, totalPaid: 0, remaining: 1 });
    expect(await pool()).toBe(1);
  });
});

describe('negative balance tracking and close-friend reminders', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await reset();
    // cat's direct friends: alice 1.0 (inviter), f3 1.0, f2 0.7, f4 0.7, f1 0.4.
    ids = await community(['alice', 'cat', 'f1', 'f2', 'f3', 'f4'], [
      ['alice', 'cat', 1.0],
      ['cat', 'f1', 0.4],
      ['cat', 'f2', 0.7],
      ['cat', 'f3', 1.0],
      ['cat', 'f4', 0.7],
    ]);
  });
  const openPeriod = () => prisma.negativeBalancePeriod.findFirst({ where: { memberId: ids.cat, recoveredAt: null } });
  const remind = (at: Date) => run(null, at, async (tx, ctx) => ({ sync: await syncNegativePeriods(tx, ctx), r: await sendNegativeBalanceReminders(tx, ctx) }));
  /** Reminders about cat (other members who go negative get their own reminders). */
  const friendNotes = () => prisma.notification.findMany({ where: { kind: 'community.friend_opportunity', entityId: ids.cat }, orderBy: { memberId: 'asc' } });

  it('partial repayment keeps the timer; exactly 50 days does not trigger; > 50 days notifies the 3 closest friends once', async () => {
    const start = addDays(T0, 1);
    await exchange(ids.f3, ids.cat, 180, start); // cat −3
    const p = await openPeriod();
    expect(p).toMatchObject({ negativeSince: start, source: 'ledger' });
    await exchange(ids.cat, ids.f3, 60, addDays(start, 10)); // partial repayment: cat −2
    expect((await openPeriod())!.negativeSince).toEqual(start);

    await remind(new Date(start.getTime() + 50 * DAY_MS));
    expect(await friendNotes()).toHaveLength(0);
    await remind(new Date(start.getTime() + 50 * DAY_MS + 60_000));
    const notes = await friendNotes();
    expect(notes.map((n) => n.memberId).sort()).toEqual([ids.alice, ids.f2, ids.f3].sort()); // 1.0, 1.0, then f2 before f4 (tie, by handle)
    expect(notes[0].body).toBe('Cat could use an opportunity to earn community credits. Consider inviting them to help with a task.');
    for (const n of notes) expect(`${n.title} ${n.body}`).not.toMatch(/-?\d+(\.\d+)?\s*credit\(s\)|balance|dispute/i);

    // Retried job: nothing new.
    await remind(new Date(start.getTime() + 52 * DAY_MS));
    expect(await friendNotes()).toHaveLength(3);
    expect(await prisma.auditEvent.count({ where: { action: 'negative_balance.reminder_sent' } })).toBe(1);
  });

  it('blocked connections are skipped; recovery to zero resets; a new period can remind again; no friends → private reminder', async () => {
    await run(ids.cat, T0, (tx, ctx) => declareConflict(tx, ctx, ids.cat, ids.alice, 'Family member'));
    const start = addDays(T0, 1);
    await exchange(ids.f1, ids.cat, 120, start); // −2
    await remind(addDays(start, 51));
    expect((await friendNotes()).map((n) => n.memberId).sort()).toEqual([ids.f2, ids.f3, ids.f4].sort());

    await exchange(ids.cat, ids.f2, 120, addDays(start, 52)); // back to 0 → period closed
    expect(await openPeriod()).toBeNull();
    expect(await prisma.negativeBalancePeriod.count({ where: { memberId: ids.cat, recoveredAt: { not: null } } })).toBe(1);

    const again = addDays(start, 60);
    await exchange(ids.f3, ids.cat, 60, again); // negative again: new period, new timer
    expect((await openPeriod())!.negativeSince).toEqual(again);
    await remind(addDays(again, 30));
    expect(await friendNotes()).toHaveLength(3);
    await remind(addDays(again, 51));
    expect(await friendNotes()).toHaveLength(6);

    // A member with no suitable friend gets a private reminder instead.
    const loner = await prisma.member.create({ data: { handle: 'loner', displayName: 'Loner', email: 'loner@t.test', passwordHash: 'x', joinedAt: T0 } });
    await run(null, T0, async (tx) => {
      await tx.ledgerAccount.create({ data: { type: 'MEMBER', memberId: loner.id, name: 'Member: Loner' } });
    });
    await run(null, T0, async (tx, ctx) => {
      const adj = await systemAccount(tx, 'SYSTEM_ADJUSTMENT');
      await postTransfer(tx, ctx, { kind: 'ADJUSTMENT', idempotencyKey: 'loner-debt', fromMemberId: loner.id, toAccountId: adj.id, amount: 100, explanation: 'test debt', ruleId: 'TEST' });
    });
    await remind(addDays(T0, 51));
    const priv = await prisma.notification.findMany({ where: { memberId: loner.id, kind: 'community.private_reminder' } });
    expect(priv).toHaveLength(1);
  });

  it('reconstructs periods that existed before tracking from ledger history', async () => {
    const start = addDays(T0, 1);
    await exchange(ids.f1, ids.cat, 120, start);
    await prisma.negativeBalancePeriod.deleteMany(); // as if the data predates the migration
    const r = await remind(addDays(start, 5));
    expect(r.sync.opened).toBe(1);
    expect(await openPeriod()).toMatchObject({ negativeSince: start, source: 'reconstructed' });
  });

  it('the daily job checks AFTER redistribution: a pool reward that clears the debt prevents the reminder', async () => {
    const start = addDays(T0, 1);
    await exchange(ids.f1, ids.cat, 60, start); // cat −1 since `start`
    await fundPool(500);
    const day = addDays(start, 55);
    await exchange(ids.cat, ids.f2, 30, hkMorning(day)); // cat −0.5
    await exchange(ids.f4, ids.cat, 30, hkMorning(day)); // cat −1 again: still negative for 55+ days
    // cat 2 points, f2 1, f4 1 → 3 active → 2 recipients; cat (highest) is always one of them.
    const runDate = addDayKey(dayKeyOf(day, HK), 1);
    const r = await runDailyJob(dueFor(runDate), { trigger: 'manual' });
    expect(r.run.status).toBe('COMPLETED');
    const d = await prisma.poolDistribution.findUniqueOrThrow({ where: { runDate }, include: { grants: true } });
    expect(d).toMatchObject({ recipientCount: 2, paymentPerRecipient: 250 });
    expect(d.grants.map((g) => g.memberId)).toContain(ids.cat);
    expect(await posted(ids.cat)).toBe(150); // −1 + 2.5
    expect(await openPeriod()).toBeNull();
    expect(await friendNotes()).toHaveLength(0);
  });

});

function addMonths13(d: Date) {
  return addDays(d, 400);
}
