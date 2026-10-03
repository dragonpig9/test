import { beforeEach, describe, expect, it } from 'vitest';
import { POLICY } from '../src/config/policy';
import { addDays, addHours } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { computeEligibility, openDispute } from '../src/modules/attestation/attestation.service';
import { evaluateEligibility, rankCandidates, type Candidate, type EligibilityContext } from '../src/modules/attestation/attestation.eligibility';
import { T0, agreed, community, reset, run, settleBoth } from './fixtures';

describe('jury ranking (pure)', () => {
  const ctx: EligibilityContext = {
    parties: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }],
    distances: new Map(),
    directRelations: new Map(),
    conflicts: new Map(),
    alreadySelected: new Set(),
    relTrust: new Map([
      ['A', new Map([['far', 0.1], ['lopsided', 0.05], ['mid', 0.3], ['t1', 0.2], ['t2', 0.2], ['t3', 0.2]])],
      ['B', new Map([['far', 0.12], ['lopsided', 0.9], ['mid', 0.3], ['t1', 0.2], ['t2', 0.2], ['t3', 0.2]])],
    ]),
  };
  const c = (id: string, score = 50, extra: Partial<Candidate> = {}): Candidate => ({ id, handle: id, displayName: id, status: 'ACTIVE', score, ...extra });
  const closeness = (cand: Candidate) => evaluateEligibility(cand, ctx).closeness!.value;

  it('uses the MAX of the two relationship trusts and prefers the lowest closeness', () => {
    expect(evaluateEligibility(c('lopsided'), ctx).closeness).toEqual({ toParties: { A: 0.05, B: 0.9 }, value: 0.9 });
    const ranked = rankCandidates([c('lopsided'), c('mid'), c('far')], closeness, 'seed');
    expect(ranked.map((x) => x.id)).toEqual(['far', 'mid', 'lopsided']);
  });
  it('randomises equally ranked candidates reproducibly from the seed', () => {
    const pool = [c('t1'), c('t2'), c('t3')];
    const one = rankCandidates(pool, closeness, 'seed-1').map((x) => x.id);
    expect(rankCandidates([...pool].reverse(), closeness, 'seed-1').map((x) => x.id)).toEqual(one);
    const orders = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => rankCandidates(pool, closeness, s).map((x) => x.id).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
  it('never prefers low credibility: score is only a threshold', () => {
    const hi = c('t1', 90);
    const lo = c('t2', POLICY.credibility.thresholds.attest);
    const ranks = ['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => rankCandidates([hi, lo], closeness, s)[0].id);
    expect(new Set(ranks)).toEqual(new Set(['t1', 't2'])); // equal closeness → coin flip, not score
    expect(evaluateEligibility(c('t3', POLICY.credibility.thresholds.attest - 1), ctx).eligible).toBe(false);
  });
  it('excludes unavailable members with a reason', () => {
    expect(evaluateEligibility(c('far', 50, { juryAvailable: false }), ctx).reasons).toContain('Marked unavailable for jury duty');
    expect(evaluateEligibility(c('far', 50, { openAssignments: POLICY.attestation.maxOpenAssignments }), ctx).reasons.join()).toMatch(/open jury assignment/);
  });
});

describe('jury selection (integration)', () => {
  let ids: Record<string, string>;
  const at = addDays(T0, 2);
  beforeEach(async () => {
    await reset();
    // Parties c (provider) and d (recipient). a, f, g, h are far enough by hops; f is close to d's side.
    ids = await community(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], [
      ['a', 'b', 1.0], ['b', 'c', 0.7], ['c', 'd', 0.7], ['d', 'e', 0.7], ['e', 'f', 1.0], ['f', 'g', 1.0], ['g', 'h', 1.0],
    ]);
    for (const [p, r] of [['a', 'b'], ['f', 'g'], ['g', 'h'], ['h', 'g'], ['b', 'a'], ['e', 'f']] as const) {
      const ex = await agreed(ids[p], ids[r], 60, addDays(T0, -100));
      await settleBoth(ex.id, ids[p], ids[r], addDays(T0, -99));
    }
  });

  it('selects a credible member with the lowest closeness and records the snapshot', async () => {
    const ex = await agreed(ids.c, ids.d, 60, at, { punctualityRequired: true });
    const d = await run(ids.d, addHours(at, 2), (tx, ctx) => openDispute(tx, ctx, ids.d, { exchangeId: ex.id, condition: 'PUNCTUALITY', claim: 'Arrived 40 minutes late; punctuality was agreed.' }));
    const sel = await prisma.attestorSelection.findFirstOrThrow({ where: { disputeId: d.id } });
    expect(sel.method).toBe('lowest-closeness-v2');
    const rows = sel.candidates as { memberId: string; eligible: boolean; score: number; closeness: { value: number; toParties: Record<string, number> } | null; rank: number | null; selectionReason: string | null; reasons: string[] }[];
    const eligible = rows.filter((r) => r.eligible);
    expect(eligible.map((r) => r.memberId).sort()).toEqual([ids.a, ids.f, ids.g, ids.h].sort());
    const chosen = rows.find((r) => r.memberId === sel.selectedIds[0])!;
    expect(chosen.score).toBeGreaterThanOrEqual(POLICY.credibility.thresholds.attest);
    expect(chosen.rank).toBe(1);
    expect(chosen.closeness!.value).toBe(Math.min(...eligible.map((r) => r.closeness!.value)));
    expect(chosen.closeness!.value).toBe(Math.max(...Object.values(chosen.closeness!.toParties)));
    expect(chosen.selectionReason).toMatch(/limited connections to either party/);
    // Excluded rows carry reasons (e.g. b is c's direct voucher).
    expect(rows.find((r) => r.memberId === ids.b)!.reasons.join()).toMatch(/Direct voucher/);
    // The juror gets a notification with the voting deadline.
    expect(await prisma.notification.count({ where: { memberId: chosen.memberId, kind: 'jury.assigned' } })).toBe(1);
  });

  it('members who opted out of jury duty are excluded with a reason; not enough jurors → NEEDS_REVIEW', async () => {
    await prisma.member.updateMany({ where: { id: { in: [ids.a, ids.f, ids.g, ids.h] } }, data: { juryAvailable: false } });
    const ex = await agreed(ids.c, ids.d, 60, at, { punctualityRequired: true });
    const d = await run(ids.d, addHours(at, 2), (tx, ctx) => openDispute(tx, ctx, ids.d, { exchangeId: ex.id, condition: 'PUNCTUALITY', claim: 'Arrived 40 minutes late; punctuality was agreed.' }));
    expect(d.status).toBe('NEEDS_REVIEW');
    expect(d.reviewReason).toMatch(/INSUFFICIENT_ATTESTORS/);
    const { rows } = await computeEligibility(prisma, d.id, addHours(at, 2));
    expect(rows.find((r) => r.memberId === ids.g)!.reasons).toContain('Marked unavailable for jury duty');
    expect(await prisma.notification.count({ where: { kind: 'dispute.needs_review', entityId: d.id } })).toBe(2);
  });
});
