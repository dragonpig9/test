import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, addHours } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { acceptExchange, confirmCompletion, proposeExchange } from '../src/modules/exchanges/exchange.service';
import { creditSummary } from '../src/modules/ledger/ledger.service';
import { runCreditExpiry } from '../src/modules/expiry/expiry.service';
import { T0, agreed, community, reset, run, settleBoth } from './fixtures';

let ids: Record<string, string>;
beforeEach(async () => {
  await reset();
  ids = await community(['alice', 'mei', 'ben', 'sam']);
});

const summary = (h: string, now = T0) => creditSummary(prisma, ids[h], now);

describe('credit floor and reservations', () => {
  it('posted 0 + reservation 2 → available −2 (allowed); reservation does not pay the provider', async () => {
    await agreed(ids.sam, ids.mei, 120, addDays(T0, 3));
    const mei = await summary('mei');
    expect(mei).toMatchObject({ posted: 0, reservedOutgoing: 200, available: -200 });
    expect((await summary('sam')).posted).toBe(0);
    expect((await summary('sam')).pendingIncoming).toBe(200);
  });

  it('blocks an acceptance that would push available below −5 with an explanation', async () => {
    await agreed(ids.sam, ids.mei, 240, addDays(T0, 3)); // −4
    await expect(agreed(ids.ben, ids.mei, 120, addDays(T0, 4))).rejects.toMatchObject({ code: 'CREDIT_FLOOR_EXCEEDED' });
    expect((await summary('mei')).available).toBe(-400);
  });

  it('concurrent acceptances cannot jointly bypass the floor', async () => {
    const mk = (provider: string, at: Date) =>
      run(ids.mei, T0, (tx, ctx) =>
        proposeExchange(tx, ctx, ids.mei, {
          counterpartyId: ids[provider], myRole: 'recipient', category: 'Cooking', deliverable: 'x', durationMinutes: 180,
          scheduledAt: at.toISOString(), location: '', punctualityRequired: false, giftBonus: 0, cancellationNoticeHours: 0, cancellationTerms: '', confirmationDays: 3,
        }),
      );
    const a = await mk('sam', addDays(T0, 5));
    const b = await mk('ben', addDays(T0, 6));
    const results = await Promise.allSettled([
      run(ids.sam, T0, (tx, ctx) => acceptExchange(tx, ctx, a.id, ids.sam, 1)),
      run(ids.ben, T0, (tx, ctx) => acceptExchange(tx, ctx, b.id, ids.ben, 1)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('CREDIT_FLOOR_EXCEEDED');
    expect((await summary('mei')).available).toBe(-300);
  });
});

describe('settlement', () => {
  it('separate accounting for unequal durations: Mei −1, Sam +1', async () => {
    const at = addDays(T0, 2);
    const tutoring = await agreed(ids.mei, ids.sam, 60, at, { category: 'Tutoring' }); // Sam pays Mei 1
    const cooking = await agreed(ids.sam, ids.mei, 120, at); // Mei pays Sam 2
    expect((await summary('mei')).available).toBe(-200);
    expect((await summary('sam')).available).toBe(-100);
    await settleBoth(tutoring.id, ids.mei, ids.sam, addHours(at, 3));
    await settleBoth(cooking.id, ids.sam, ids.mei, addHours(at, 3));
    const now = addHours(at, 4);
    expect(await summary('mei', now)).toMatchObject({ posted: -100, reservedOutgoing: 0, available: -100 });
    expect(await summary('sam', now)).toMatchObject({ posted: 100, reservedOutgoing: 0 });
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'SETTLEMENT' } })).toBe(2);
  });

  it('is atomic and duplicate-proof (repeat and concurrent confirmations)', async () => {
    const at = addDays(T0, 1);
    const ex = await agreed(ids.sam, ids.mei, 60, at);
    const when = addHours(at, 2);
    await run(ids.sam, when, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.sam));
    await expect(run(ids.sam, when, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.sam))).rejects.toMatchObject({ code: 'ALREADY_DONE' });
    const results = await Promise.allSettled([1, 2, 3].map(() => run(ids.mei, when, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.mei))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.ledgerTransaction.count({ where: { exchangeId: ex.id } })).toBe(1);
    expect((await summary('sam', when)).posted).toBe(100);
    const sum = await prisma.ledgerEntry.aggregate({ _sum: { amount: true } });
    expect(sum._sum.amount).toBe(0);
  });

  it('cannot confirm before the scheduled time', async () => {
    const ex = await agreed(ids.sam, ids.mei, 60, addDays(T0, 5));
    await expect(run(ids.sam, T0, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.sam))).rejects.toMatchObject({ code: 'SERVICE_NOT_YET_DUE' });
  });

  it('gift bonus is reserved separately and only the recipient can offer it', async () => {
    const ex = await agreed(ids.sam, ids.mei, 60, addDays(T0, 2), { giftBonus: 50 });
    const r = await prisma.reservation.findUniqueOrThrow({ where: { exchangeId: ex.id } });
    expect(r).toMatchObject({ amount: 100, giftBonus: 50 });
    await expect(
      run(ids.sam, T0, (tx, ctx) =>
        proposeExchange(tx, ctx, ids.sam, {
          counterpartyId: ids.mei, myRole: 'provider', category: 'Cooking', deliverable: 'x', durationMinutes: 60,
          scheduledAt: addDays(T0, 3).toISOString(), location: '', punctualityRequired: false, giftBonus: 50, cancellationNoticeHours: 0, cancellationTerms: '', confirmationDays: 3,
        }),
      ),
    ).rejects.toMatchObject({ code: 'GIFT_ONLY_FROM_RECIPIENT' });
  });
});

describe('credit expiry', () => {
  it('expires old positive lots as a balanced event, never debts, and protects reserved credits', async () => {
    const at = addDays(T0, 1);
    const ex = await agreed(ids.sam, ids.mei, 180, at); // Sam earns 3
    await settleBoth(ex.id, ids.sam, ids.mei, addHours(at, 4));
    // Sam reserves 1 credit for something new before the lot expires.
    const later = addDays(T0, 360);
    await agreed(ids.ben, ids.sam, 60, addDays(later, 30));
    const afterExpiry = addDays(T0, 400);
    const res = await run(null, afterExpiry, (tx, ctx) => runCreditExpiry(tx, ctx));
    expect(res).toEqual([{ memberId: ids.sam, name: 'Sam', amount: 200 }]);
    expect(await summary('sam', afterExpiry)).toMatchObject({ posted: 100, reservedOutgoing: 100, available: 0 });
    expect((await summary('mei', afterExpiry)).posted).toBe(-300); // debt does not expire
    const again = await run(null, afterExpiry, (tx, ctx) => runCreditExpiry(tx, ctx));
    expect(again).toEqual([]);
    expect((await prisma.ledgerEntry.aggregate({ _sum: { amount: true } }))._sum.amount).toBe(0);
  });
});
