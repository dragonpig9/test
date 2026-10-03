import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { addMinutes } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { zonedTimeUtc } from '../src/core/timezone';
import { signToken } from '../src/modules/auth/auth.service';
import { communityRegularProgress } from '../src/modules/badges/badges.rules';
import { evaluateBadges } from '../src/modules/badges/badges.service';
import { computeCredibility, permissionsOf } from '../src/modules/credibility/credibility.service';
import { creditSummary } from '../src/modules/ledger/ledger.service';
import { loadTrust, relationshipTrust } from '../src/modules/trust/trust.service';
import { agreed, community, reset, run, settleBoth } from './fixtures';

const app = createApp();
const HK = 'Asia/Hong_Kong';
const auth = (id: string) => ({ authorization: `Bearer ${signToken(id)}` });
const janDay = (d: number) => zonedTimeUtc(`2026-01-${String(d).padStart(2, '0')}`, HK, 10);

async function exchange(providerId: string, recipientId: string, when: Date) {
  const e = await agreed(providerId, recipientId, 60, addMinutes(when, -90));
  await settleBoth(e.id, providerId, recipientId, when);
  return e;
}
const badgesOf = async (id: string) => (await prisma.memberBadge.findMany({ where: { memberId: id }, orderBy: { kind: 'asc' } })).map((b) => `${b.kind}:${b.period}`);

describe('badge rules (pure)', () => {
  const rule = { minDays: 3, minCounterparties: 2 };
  it('Community Regular needs 3 different days AND 2 different people', () => {
    expect(communityRegularProgress([{ day: 'd1', counterpartyId: 'B' }, { day: 'd2', counterpartyId: 'C' }, { day: 'd3', counterpartyId: 'B' }], rule).earned).toBe(true);
    expect(communityRegularProgress([{ day: 'd1', counterpartyId: 'B' }, { day: 'd2', counterpartyId: 'B' }, { day: 'd3', counterpartyId: 'B' }], rule).earned).toBe(false);
    expect(communityRegularProgress([{ day: 'd1', counterpartyId: 'B' }, { day: 'd1', counterpartyId: 'C' }, { day: 'd2', counterpartyId: 'D' }], rule).earned).toBe(false);
  });
});

describe('recognition badges', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await reset();
    ids = await community(['alice', 'ben', 'cat', 'dan']);
  });

  it('First Exchange is awarded once, after the first qualifying settled exchange, with a celebration notification', async () => {
    expect(await badgesOf(ids.ben)).toEqual([]);
    await exchange(ids.cat, ids.ben, janDay(5));
    expect(await badgesOf(ids.ben)).toEqual(['FIRST_EXCHANGE:once']);
    expect(await badgesOf(ids.cat)).toEqual(['FIRST_EXCHANGE:once']);
    await exchange(ids.ben, ids.cat, janDay(6));
    // Re-evaluating (as a retried settlement would) never awards twice.
    await run(null, janDay(6), (tx, ctx) => evaluateBadges(tx, ctx, [ids.ben, ids.cat]));
    expect(await badgesOf(ids.ben)).toEqual(['FIRST_EXCHANGE:once']);
    expect(await prisma.notification.count({ where: { memberId: ids.ben, kind: 'badge.awarded' } })).toBe(1);
  });

  it('Community Regular: points on 3 different Hong Kong days with 2 different people in one month', async () => {
    await exchange(ids.cat, ids.ben, janDay(5));
    await exchange(ids.ben, ids.cat, janDay(6));
    expect(await badgesOf(ids.ben)).toEqual(['FIRST_EXCHANGE:once']);
    await exchange(ids.cat, ids.ben, janDay(7)); // pair cap reached: no point, still one counterparty
    expect(await badgesOf(ids.ben)).toEqual(['FIRST_EXCHANGE:once']);
    await exchange(ids.ben, ids.alice, janDay(8)); // third day with points, second person
    expect(await badgesOf(ids.ben)).toEqual(['COMMUNITY_REGULAR:2026-01', 'FIRST_EXCHANGE:once']);
    expect(await badgesOf(ids.cat)).toEqual(['FIRST_EXCHANGE:once']);
  });

  it('badges never change credits, credibility, relationship strength or permissions', async () => {
    await exchange(ids.cat, ids.ben, janDay(5));
    await exchange(ids.ben, ids.cat, janDay(6));
    await exchange(ids.ben, ids.alice, janDay(7));
    await prisma.memberBadge.deleteMany();
    const snapshot = async () => {
      const trust = await loadTrust(prisma, janDay(9));
      return {
        credits: await creditSummary(prisma, ids.ben, janDay(9)),
        credibility: (await computeCredibility(prisma, ids.ben, janDay(9))).score,
        relationship: relationshipTrust(trust, ids.ben, ids.cat),
        permissions: await permissionsOf(prisma, ids.ben, janDay(9)),
        ledgerRows: await prisma.ledgerTransaction.count(),
      };
    };
    const before = await snapshot();
    const awarded = await run(null, janDay(9), (tx, ctx) => evaluateBadges(tx, ctx, [ids.ben]));
    expect(awarded.map((a) => a.kind).sort()).toEqual(['COMMUNITY_REGULAR', 'FIRST_EXCHANGE']);
    expect(await snapshot()).toEqual(before);
  });

  it('members choose whether others see their badges', async () => {
    await exchange(ids.cat, ids.ben, janDay(5));
    const visible = await request(app).get(`/api/profiles/${ids.ben}`).set(auth(ids.alice));
    expect(visible.body.profile.badges.map((b: { label: string }) => b.label)).toEqual(['First Exchange']);
    const hide = await request(app).put('/api/badges/me/visibility').set(auth(ids.ben)).send({ showBadges: false });
    expect(hide.body).toMatchObject({ showBadges: false, badges: [{ kind: 'FIRST_EXCHANGE' }] });
    expect((await request(app).get(`/api/profiles/${ids.ben}`).set(auth(ids.alice))).body.profile.badges).toBeNull();
    expect((await request(app).get(`/api/profiles/${ids.ben}`).set(auth(ids.ben))).body.profile.badges).toHaveLength(1); // always visible to yourself
  });
});
