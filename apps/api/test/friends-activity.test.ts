import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { addDays, addMinutes } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { zonedTimeUtc } from '../src/core/timezone';
import { signToken } from '../src/modules/auth/auth.service';
import { friendsActivity } from '../src/modules/friends-activity/friends-activity.service';
import { monthDays, monthOf, scoreMonthlyActivity, sumServiceCredits } from '../src/modules/friends-activity/friends-activity.rules';
import { systemAccount } from '../src/modules/ledger/ledger.repo';
import { postTransfer } from '../src/modules/ledger/ledger.service';
import { agreed, community, reset, run, settleBoth } from './fixtures';

const app = createApp();
const HK = 'Asia/Hong_Kong';
const auth = (id: string) => ({ authorization: `Bearer ${signToken(id)}` });
const at = (iso: string) => new Date(iso);
const params = (startDay: string, endDay: string) => ({ timezone: HK, startDay, endDay, pointsPerQualifyingExchange: 1, perPairPerDay: 1, perPairPerMonth: 2 });
let n = 0;
const ex = (providerId: string, recipientId: string, settledAt: string) => ({ id: `ex${String(++n).padStart(3, '0')}`, providerId, recipientId, settledAt: at(settledAt) });
const pts = (m: ReturnType<typeof scoreMonthlyActivity>) => Object.fromEntries([...m.values()].map((v) => [v.memberId, v.points]));

describe('monthly activity points (pure)', () => {
  const oct = params('2026-10-01', '2026-10-31');

  it('same-day repeats and role switching add nothing; different people do', () => {
    const s = scoreMonthlyActivity(
      [
        ex('A', 'B', '2026-10-05T02:00:00Z'),
        ex('A', 'B', '2026-10-05T03:00:00Z'), // repeat, same HK day
        ex('B', 'A', '2026-10-05T04:00:00Z'), // roles switched, same HK day
        ex('A', 'C', '2026-10-05T05:00:00Z'), // a different counterparty
      ],
      oct,
    );
    expect(pts(s)).toEqual({ A: 2, B: 1, C: 1 });
  });

  it('a pair earns each other at most two points per member per month, across roles and split tasks', () => {
    const s = scoreMonthlyActivity(
      [ex('A', 'B', '2026-10-01T02:00:00Z'), ex('B', 'A', '2026-10-02T02:00:00Z'), ex('A', 'B', '2026-10-03T02:00:00Z'), ex('B', 'A', '2026-10-04T02:00:00Z')],
      oct,
    );
    expect(pts(s)).toEqual({ A: 2, B: 2 });
    expect(s.get('A')!.credited.map((c) => c.day)).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('uses Hong Kong month boundaries (January/February and December/January)', () => {
    const jan = params('2026-01-01', '2026-01-31');
    const feb = params('2026-02-01', '2026-02-28');
    const lateJanUtc = ex('A', 'B', '2026-01-31T16:30:00Z'); // 1 Feb 00:30 in Hong Kong
    expect(pts(scoreMonthlyActivity([lateJanUtc], jan))).toEqual({});
    expect(pts(scoreMonthlyActivity([lateJanUtc], feb))).toEqual({ A: 1, B: 1 });

    const dec = params('2025-12-01', '2025-12-31');
    const lastDec = ex('A', 'B', '2025-12-31T15:59:00Z'); // 31 Dec 23:59 HKT
    const firstJan = ex('A', 'B', '2025-12-31T16:00:00Z'); // 1 Jan 00:00 HKT
    expect(pts(scoreMonthlyActivity([lastDec, firstJan], dec))).toEqual({ A: 1, B: 1 });
    expect(pts(scoreMonthlyActivity([lastDec, firstJan], jan))).toEqual({ A: 1, B: 1 });
    // The monthly pair cap starts again in the new month.
    const decCapped = [ex('A', 'B', '2025-12-29T02:00:00Z'), ex('A', 'B', '2025-12-30T02:00:00Z'), lastDec];
    expect(pts(scoreMonthlyActivity([...decCapped, firstJan], dec))).toEqual({ A: 2, B: 2 });
    expect(pts(scoreMonthlyActivity([...decCapped, firstJan], jan))).toEqual({ A: 1, B: 1 });

    expect(monthDays(2026, 2)).toEqual({ startDay: '2026-02-01', endDay: '2026-02-28', nextMonthStartDay: '2026-03-01' });
    expect(monthDays(2028, 2).endDay).toBe('2028-02-29');
    expect(monthDays(2025, 12).nextMonthStartDay).toBe('2026-01-01');
    expect(monthOf(at('2025-12-31T16:00:00Z'), HK)).toEqual({ year: 2026, month: 1 });
  });

  it('counts provider earnings and recipient spending separately, with reversals negative', () => {
    const t = sumServiceCredits([
      { providerId: 'B', recipientId: 'A', units: 300 },
      { providerId: 'A', recipientId: 'B', units: 100 },
      { providerId: 'B', recipientId: 'A', units: -100 }, // refund of part of the first service
    ]);
    expect(Object.fromEntries(t)).toEqual({ A: { earned: 100, spent: 200 }, B: { earned: 200, spent: 100 } });
  });
});

describe('Friends activity (integration)', () => {
  let ids: Record<string, string>;
  // 10:00 Hong Kong time on 2026-01-d.
  const janDay = (d: number) => zonedTimeUtc(`2026-01-${String(d).padStart(2, '0')}`, HK, 10);
  async function exchange(providerId: string, recipientId: string, minutes: number, when: Date, gift = 0) {
    const e = await agreed(providerId, recipientId, minutes, addMinutes(when, -90), { giftBonus: gift });
    await settleBoth(e.id, providerId, recipientId, when);
    return e;
  }
  beforeEach(async () => {
    await reset();
    ids = await community(['alice', 'ben', 'cat', 'dan']); // chain alice → ben → cat → dan
  });

  it('A pays B 3 credits: A spent 3, B earned 3, one point each; gifts are excluded', async () => {
    await exchange(ids.cat, ids.ben, 180, janDay(5)); // ben (recipient) pays cat 3 credits
    await exchange(ids.ben, ids.cat, 60, janDay(6), 50); // cat pays ben 1 credit + 0.5 gift
    const v = await friendsActivity(prisma, ids.ben, 2026, 1, janDay(20));
    const row = (h: string) => v.entries.find((e) => e.member.handle === h)!;
    expect(row('ben')).toMatchObject({ points: 2, creditsSpent: 300, creditsEarned: 100, isMe: true });
    expect(row('cat')).toMatchObject({ points: 2, creditsEarned: 300, creditsSpent: 100 });
    expect(v).toMatchObject({ label: 'Friends activity', year: 2026, month: 1, monthName: 'January', timezone: HK, isCurrentMonth: true });
  });

  it('a recorded refund of a settled service reduces both totals; other adjustments are ignored', async () => {
    const e = await exchange(ids.cat, ids.ben, 120, janDay(5)); // ben pays cat 2 credits
    await run(null, janDay(7), (tx, ctx) =>
      postTransfer(tx, ctx, { kind: 'ADJUSTMENT', idempotencyKey: `refund:${e.id}`, exchangeId: e.id, fromMemberId: ids.cat, toMemberId: ids.ben, amount: 100, explanation: 'Refund of one hour', ruleId: 'TEST' }),
    );
    await run(null, janDay(8), async (tx, ctx) => {
      const adj = await systemAccount(tx, 'SYSTEM_ADJUSTMENT');
      await postTransfer(tx, ctx, { kind: 'ADJUSTMENT', idempotencyKey: 'admin-grant', fromAccountId: adj.id, toMemberId: ids.cat, amount: 500, explanation: 'Administrative', ruleId: 'TEST' });
    });
    const v = await friendsActivity(prisma, ids.ben, 2026, 1, janDay(20));
    expect(v.entries.find((x) => x.member.handle === 'cat')).toMatchObject({ creditsEarned: 100, points: 1 });
    expect(v.entries.find((x) => x.isMe)).toMatchObject({ creditsSpent: 100, points: 1 });
  });

  it('credit totals keep counting after the point caps; equal scores share a rank', async () => {
    for (const d of [5, 6, 7, 8]) await exchange(ids.cat, ids.ben, 60, janDay(d)); // same pair, four days
    const v = await friendsActivity(prisma, ids.ben, 2026, 1, janDay(20));
    const ben = v.entries.find((e) => e.isMe)!;
    const cat = v.entries.find((e) => e.member.handle === 'cat')!;
    expect(ben).toMatchObject({ points: 2, creditsSpent: 400, rank: 1 });
    expect(cat).toMatchObject({ points: 2, creditsEarned: 400, rank: 1 }); // tie → same rank
    expect(v.entries.find((e) => e.member.handle === 'alice')).toMatchObject({ points: 0, rank: 3 });
  });

  it('historical months are read-only and the API defaults to the current month', async () => {
    await exchange(ids.cat, ids.ben, 60, janDay(5));
    const now = addDays(janDay(5), 40); // mid-February
    const counts = async () => [await prisma.auditEvent.count(), await prisma.ledgerTransaction.count(), await prisma.notification.count(), await prisma.creditLot.count(), await prisma.credibilitySnapshot.count()];
    await prisma.systemState.update({ where: { id: 1 }, data: { simulatedNow: now } });
    const before = await counts();
    const jan = await request(app).get('/api/friends-activity?year=2026&month=1').set(auth(ids.ben));
    expect(jan.body).toMatchObject({ month: 1, isCurrentMonth: false });
    expect(jan.body.entries.find((e: { isMe: boolean }) => e.isMe).points).toBe(1);
    const cur = await request(app).get('/api/friends-activity').set(auth(ids.ben));
    expect(cur.body).toMatchObject({ year: 2026, month: 2, monthName: 'February', isCurrentMonth: true });
    expect(cur.body.entries.find((e: { isMe: boolean }) => e.isMe).points).toBe(0);
    expect(await counts()).toEqual(before);
    expect((await request(app).get('/api/friends-activity?year=2026&month=13').set(auth(ids.ben))).status).toBe(400);
  });
});
