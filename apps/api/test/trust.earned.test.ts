import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, addHours } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { castVote, openDispute } from '../src/modules/attestation/attestation.service';
import { cancelExchange, confirmCompletion } from '../src/modules/exchanges/exchange.service';
import { nextEarnedStrength, effectiveEarned } from '../src/modules/trust/trust.earned.rules';
import { recordEarnedTrust } from '../src/modules/trust/trust.earned';
import { buildGraph, buildRelationshipGraph, combinePair, shortestPathsFrom, strongestPathsFrom } from '../src/modules/trust/trust.graph';
import { findPath, loadTrust, relationshipTrust } from '../src/modules/trust/trust.service';
import { T0, agreed, community, reset, run, settleBoth } from './fixtures';

const d = (s: string) => new Date(s);

describe('earned trust rules (pure)', () => {
  it('starts a new earned relationship at 0.2 and grows by 0.10 × (1 − old), capped at 0.7', () => {
    const now = d('2026-01-10');
    expect(nextEarnedStrength(null, 0, now)).toMatchObject({ previousStrength: 0, newStrength: 0.2, applied: true });
    expect(nextEarnedStrength({ strength: 0.2, lastExchangeAt: d('2026-01-01') }, 0, now)).toMatchObject({ newStrength: 0.28, applied: true });
    expect(nextEarnedStrength({ strength: 0.68, lastExchangeAt: d('2026-01-01') }, 0, now)).toMatchObject({ newStrength: 0.7, applied: true });
    expect(nextEarnedStrength({ strength: 0.7, lastExchangeAt: d('2026-01-01') }, 0, now)).toMatchObject({ newStrength: 0.7, applied: false });
  });
  it('limits repeated exchanges between the same pair (2 per 30 days count)', () => {
    const r = nextEarnedStrength({ strength: 0.28, lastExchangeAt: d('2026-01-09') }, 2, d('2026-01-10'));
    expect(r).toMatchObject({ previousStrength: 0.28, newStrength: 0.28, applied: false });
    expect(r.reason).toMatch(/at most 2 exchanges per pair/);
  });
  it('decays after 12 idle months and expires after 18, like vouches', () => {
    const e = { strength: 0.4, lastExchangeAt: d('2025-01-01') };
    expect(effectiveEarned(e, d('2025-06-01'))).toMatchObject({ status: 'ACTIVE', effectiveStrength: 0.4, decayed: false });
    expect(effectiveEarned(e, d('2026-02-01'))).toMatchObject({ status: 'ACTIVE', effectiveStrength: 0.2, decayed: true });
    expect(effectiveEarned(e, d('2026-08-01'))).toMatchObject({ status: 'EXPIRED', effectiveStrength: 0 });
    // A decayed edge restarts from its effective value.
    expect(nextEarnedStrength(e, 0, d('2026-02-01'))).toMatchObject({ previousStrength: 0.2, newStrength: 0.28 });
  });
});

describe('strongest path (graph fix)', () => {
  const members = ['mei', 'alice', 'ben', 'sam', 'zed', 'yan'].map((h) => ({ id: h, handle: h }));
  const chain = [
    { id: 'v1', a: 'alice', b: 'mei', w: 0.7 },
    { id: 'v2', a: 'alice', b: 'ben', w: 1.0 },
    { id: 'v3', a: 'ben', b: 'sam', w: 0.7 },
  ];
  it('a new weak direct edge does not reduce relationship trust (BFS would)', () => {
    const before = strongestPathsFrom(buildRelationshipGraph(members, chain, []).graph, 'mei').get('sam')!;
    expect(before.strength).toBeCloseTo(0.49, 10);
    const weakDirect = [{ id: 'e1', a: 'mei', b: 'sam', w: 0.2 }];
    const rel = buildRelationshipGraph(members, chain, weakDirect).graph;
    const after = strongestPathsFrom(rel, 'mei').get('sam')!;
    expect(after.strength).toBeCloseTo(0.49, 10);
    expect(after.nodes).toEqual(['mei', 'alice', 'ben', 'sam']);
    // The old hop-first BFS would have switched to the 1-hop 0.2 edge.
    expect(shortestPathsFrom(rel, 'mei').get('sam')!.strength).toBeCloseTo(0.2, 10);
  });
  it('prefers the stronger longer path, then fewer hops on equal strength, then handles', () => {
    const g = buildGraph(members, [
      { id: 'a', a: 'mei', b: 'sam', w: 0.4 },
      { id: 'b', a: 'mei', b: 'ben', w: 1.0 },
      { id: 'c', a: 'ben', b: 'sam', w: 1.0 },
    ]);
    expect(strongestPathsFrom(g, 'mei').get('sam')!.nodes).toEqual(['mei', 'ben', 'sam']);
    const tie = buildGraph(members, [
      { id: 'a', a: 'mei', b: 'sam', w: 0.5 },
      { id: 'b', a: 'mei', b: 'ben', w: 1.0 },
      { id: 'c', a: 'ben', b: 'sam', w: 0.5 },
    ]);
    expect(strongestPathsFrom(tie, 'mei').get('sam')!.hops).toBe(1);
    const tie2 = buildGraph(members, [
      { id: 'a', a: 'mei', b: 'zed', w: 0.7 },
      { id: 'b', a: 'zed', b: 'sam', w: 1.0 },
      { id: 'c', a: 'mei', b: 'yan', w: 0.7 },
      { id: 'd', a: 'yan', b: 'sam', w: 1.0 },
    ]);
    expect(strongestPathsFrom(tie2, 'mei').get('sam')!.nodes).toEqual(['mei', 'yan', 'sam']);
  });
  it('combines a vouch and an earned edge on the same pair as 1 − (1 − v)(1 − e)', () => {
    expect(combinePair(0.7, 0.2)).toBeCloseTo(0.76, 10);
    expect(combinePair(0.7, 0)).toBe(0.7);
    expect(combinePair(0, 0.2)).toBeCloseTo(0.2, 10);
  });
});

describe('earned trust after completed exchanges (integration)', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await reset();
    // Chain a–b–c–d–e–f–g–h so the pair (c, f) is three vouch hops apart.
    ids = await community(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], [
      ['a', 'b', 1.0], ['b', 'c', 0.7], ['c', 'd', 0.7], ['d', 'e', 0.7], ['e', 'f', 1.0], ['f', 'g', 1.0], ['g', 'h', 1.0],
    ]);
  });

  it('a successful exchange increases trust exactly once (retries, repeat confirmations, re-running the hook)', async () => {
    const at = addDays(T0, 2);
    const ex = await agreed(ids.c, ids.f, 60, at);
    const trustBefore = relationshipTrust(await loadTrust(prisma, at), ids.c, ids.f);
    await settleBoth(ex.id, ids.c, ids.f, addHours(at, 2));
    await expect(run(ids.f, addHours(at, 3), (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.f))).rejects.toMatchObject({ code: 'ALREADY_DONE' });
    // Calling the hook again (e.g. a retried job) finds the existing row and changes nothing.
    await run(ids.c, addHours(at, 4), (tx, ctx) => recordEarnedTrust(tx, ctx, { id: ex.id, providerId: ids.c, recipientId: ids.f, deliverable: 'x' }));
    const updates = await prisma.trustUpdate.findMany({ where: { exchangeId: ex.id } });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ previousStrength: 0, newStrength: 0.2, applied: true });
    const rel = await prisma.earnedRelationship.findFirstOrThrow();
    expect(rel).toMatchObject({ strength: 0.2, countedExchanges: 1 });
    // Relationship trust never goes down: c–f was 0.7 × 0.7 × 1.0 = 0.49 > the new 0.2 edge, so it stays.
    const trustAfter = relationshipTrust(await loadTrust(prisma, addHours(at, 4)), ids.c, ids.f);
    expect(trustBefore).toBeCloseTo(0.49, 4);
    expect(trustAfter).toBeCloseTo(0.49, 4);
    expect(updates[0]).toMatchObject({ relationshipTrustBefore: 0.49, relationshipTrustAfter: 0.49 });
    // Audit and one notification per party.
    expect(await prisma.auditEvent.count({ where: { action: 'trust.earned_increased', entityId: ex.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { kind: 'trust.changed', entityId: ex.id } })).toBe(2);
  });

  it('keeps earned edges distinct from vouches: no vouch, no liability is created', async () => {
    const at = addDays(T0, 2);
    const vouchesBefore = await prisma.vouch.count();
    const ex = await agreed(ids.c, ids.f, 60, at);
    await settleBoth(ex.id, ids.c, ids.f, addHours(at, 2));
    expect(await prisma.vouch.count()).toBe(vouchesBefore);
    const next = await agreed(ids.f, ids.c, 60, addDays(at, 1));
    const snap = (await prisma.exchange.findUniqueOrThrow({ where: { id: next.id } })).liabilitySnapshot as { voucherId: string }[];
    expect(snap.some((s) => s.voucherId === ids.c || s.voucherId === ids.f)).toBe(false);
    const path = findPath(await loadTrust(prisma, addDays(at, 1)), ids.c, ids.f);
    expect(path.fewestVouchHops).toBe(3);
  });

  it('a strong enough earned edge raises relationship trust and becomes the strongest path', async () => {
    // Far apart (a … h = 7 hops of mostly 1.0 and 0.7): 1 × 0.7 × 0.7 × 0.7 × 1 × 1 × 1 = 0.343.
    let at = addDays(T0, 2);
    const before = relationshipTrust(await loadTrust(prisma, at), ids.a, ids.h);
    // Alternate who provides so nobody hits the credit floor.
    const once = async (i: number) => {
      const [p, r] = i % 2 ? [ids.h, ids.a] : [ids.a, ids.h];
      const ex = await agreed(p, r, 60, at);
      await settleBoth(ex.id, p, r, addHours(at, 2));
      at = addDays(at, 20);
    };
    for (let i = 0; i < 2; i++) await once(i);
    const after = relationshipTrust(await loadTrust(prisma, at), ids.a, ids.h);
    expect(before).toBeCloseTo(0.343, 4);
    expect(after).toBeCloseTo(0.343, 4); // 0.28 earned < 0.343: no decrease, no false increase
    for (let i = 2; i < 6; i++) await once(i);
    const strength = (await prisma.earnedRelationship.findFirstOrThrow()).strength;
    expect(strength).toBeGreaterThan(0.343);
    expect(relationshipTrust(await loadTrust(prisma, at), ids.a, ids.h)).toBeCloseTo(strength, 4);
  });

  it('only 2 exchanges per pair per 30 days increase trust', async () => {
    const at = addDays(T0, 2);
    for (let i = 0; i < 3; i++) {
      const when = addHours(at, i * 5);
      const ex = await agreed(ids.c, ids.f, 60, when);
      await settleBoth(ex.id, ids.c, ids.f, addHours(when, 2));
    }
    const ups = await prisma.trustUpdate.findMany({ orderBy: { createdAt: 'asc' } });
    expect(ups.map((u) => u.applied)).toEqual([true, true, false]);
    expect((await prisma.earnedRelationship.findFirstOrThrow()).strength).toBe(0.28);
  });

  it('no trust increase for cancelled, refuted or attestation-settled exchanges', async () => {
    // Cancelled.
    const c1 = await agreed(ids.c, ids.f, 60, addDays(T0, 10));
    await run(ids.f, T0, (tx, ctx) => cancelExchange(tx, ctx, c1.id, ids.f, 'Plans changed'));
    // Disputed and refuted: needs eligible jurors; give a, h some history so they meet the threshold.
    for (const [p, r] of [['a', 'b'], ['b', 'a'], ['g', 'h'], ['h', 'g']] as const) {
      const ex = await agreed(ids[p], ids[r], 60, addDays(T0, -100));
      await settleBoth(ex.id, ids[p], ids[r], addDays(T0, -99));
    }
    const before = await prisma.trustUpdate.count();
    const at = addDays(T0, 3);
    const ex = await agreed(ids.c, ids.f, 60, at);
    const disp = await run(ids.f, addHours(at, 2), (tx, ctx) => openDispute(tx, ctx, ids.f, { exchangeId: ex.id, condition: 'NO_SHOW', claim: 'Provider never arrived at the agreed time.' }));
    const juror = (await prisma.attestorAssignment.findFirstOrThrow({ where: { disputeId: disp.id } })).attestorId;
    await run(juror, addHours(at, 3), (tx, ctx) => castVote(tx, ctx, disp.id, juror, 'REFUTED', 'Both agree nobody arrived at the agreed time.'));
    expect(await prisma.trustUpdate.count()).toBe(before);
    expect(await prisma.earnedRelationship.count({ where: { OR: [{ memberAId: ids.c, memberBId: ids.f }, { memberAId: ids.f, memberBId: ids.c }] } })).toBe(0);
  });
});
