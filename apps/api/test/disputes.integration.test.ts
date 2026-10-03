import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, addHours } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { castVote, openDispute, proposeMutual, retrySelection } from '../src/modules/attestation/attestation.service';
import { computeCredibility } from '../src/modules/credibility/credibility.service';
import { confirmCompletion, cancelExchange } from '../src/modules/exchanges/exchange.service';
import { creditSummary } from '../src/modules/ledger/ledger.service';
import { leaveCommunity } from '../src/modules/withdrawal/withdrawal.service';
import { revokeVouch } from '../src/modules/vouches/vouch.service';
import { T0, agreed, community, reset, run, settleBoth } from './fixtures';

let ids: Record<string, string>;
const at = addDays(T0, 2);
const after = addHours(at, 3);

/**
 * Chain a–b–c–d–e–f–g–h. Parties c (provider) and d (recipient).
 * Eligible (≥2 hops, not direct relation): a, f, g, h — all have enough credibility? We raise scores
 * with settled history so the attestor threshold is met.
 */
async function build() {
  ids = await community(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], [
    ['a', 'b', 1.0], ['b', 'c', 0.7], ['c', 'd', 0.7], ['d', 'e', 0.7], ['e', 'f', 1.0], ['f', 'g', 1.0], ['g', 'h', 1.0],
  ]);
  // Give potential attestors some history so they pass the attestor threshold (30).
  for (const [p, r] of [['a', 'b'], ['f', 'g'], ['g', 'h'], ['h', 'g'], ['b', 'a'], ['e', 'f']] as const) {
    const ex = await agreed(ids[p], ids[r], 60, addDays(T0, -100));
    await settleBoth(ex.id, ids[p], ids[r], addDays(T0, -99));
  }
}

async function disputed(punctual = true) {
  const ex = await agreed(ids.c, ids.d, 60, at, { punctualityRequired: punctual });
  const d = await run(ids.d, after, (tx, ctx) => openDispute(tx, ctx, ids.d, { exchangeId: ex.id, condition: 'PUNCTUALITY', claim: 'Arrived 40 minutes late; punctuality was agreed.' }));
  return { ex, d };
}

beforeEach(async () => {
  await reset();
  await build();
});

describe('disputes and attestation', () => {
  it('opening a dispute freezes credits, keeps them unspendable and changes no credibility', async () => {
    const before = await computeCredibility(prisma, ids.c, after);
    const { ex, d } = await disputed();
    const r = await prisma.reservation.findUniqueOrThrow({ where: { exchangeId: ex.id } });
    expect(r.status).toBe('FROZEN');
    expect(d.status).toBe('AWAITING_ATTESTATION');
    const s = await creditSummary(prisma, ids.d, after);
    expect(s).toMatchObject({ reservedOutgoing: 100, disputedOutgoing: 100, available: s.posted - 100 });
    expect((await computeCredibility(prisma, ids.c, after)).score).toBe(before.score);
    // Frozen credits still count against the floor.
    await agreed(ids.e, ids.d, 240, addDays(at, 3)); // −4 more → available −5 exactly
    await expect(agreed(ids.e, ids.d, 60, addDays(at, 4))).rejects.toMatchObject({ code: 'CREDIT_FLOOR_EXCEEDED' });
  });

  it('records eligibility with reasons and a reproducible seed', async () => {
    const { d } = await disputed();
    const sel = await prisma.attestorSelection.findFirstOrThrow({ where: { disputeId: d.id } });
    const rows = sel.candidates as { memberId: string; eligible: boolean; reasons: string[] }[];
    const eligible = rows.filter((r) => r.eligible).map((r) => r.memberId).sort();
    expect(eligible).toEqual([ids.a, ids.f, ids.g, ids.h].sort());
    expect(rows.find((r) => r.memberId === ids.b)!.reasons.join()).toMatch(/Direct voucher/);
    expect(sel.seed).toContain('commonhours-demo');
    expect(sel.selectedIds).toHaveLength(1);
  });

  it('confirmed → settles credits; refuted → releases and penalises provider and DIRECT voucher only', async () => {
    const { ex, d } = await disputed();
    const attestor = (await prisma.attestorAssignment.findFirstOrThrow({ where: { disputeId: d.id } })).attestorId;
    await run(attestor, after, (tx, ctx) => castVote(tx, ctx, d.id, attestor, 'CONFIRMED', 'Messages show the start time was moved by agreement.'));
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe('SETTLED');
    expect((await creditSummary(prisma, ids.c, after)).posted).toBe(100);
    expect(await prisma.credibilityPenalty.count()).toBe(0);

    const second = await agreed(ids.c, ids.d, 60, addDays(at, 5), { punctualityRequired: true });
    const later = addHours(addDays(at, 5), 3);
    const d2 = await run(ids.d, later, (tx, ctx) => openDispute(tx, ctx, ids.d, { exchangeId: second.id, condition: 'NO_SHOW', claim: 'Provider never arrived at the agreed time.' }));
    const att2 = (await prisma.attestorAssignment.findFirstOrThrow({ where: { disputeId: d2.id, status: 'ASSIGNED' } })).attestorId;
    // Revoking the vouch after acceptance must not erase liability.
    const bc = await prisma.vouch.findFirstOrThrow({ where: { voucherId: ids.b, voucheeId: ids.c } });
    await run(ids.b, later, (tx, ctx) => revokeVouch(tx, ctx, bc.id, ids.b, 'changed my mind'));
    await run(att2, later, (tx, ctx) => castVote(tx, ctx, d2.id, att2, 'REFUTED', 'Both sides agree nobody arrived; the activity did not occur.'));
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('RELEASED');
    expect((await prisma.reservation.findUniqueOrThrow({ where: { exchangeId: second.id } })).status).toBe('RELEASED');
    const penalties = await prisma.credibilityPenalty.findMany();
    expect(penalties.map((p) => [p.memberId, p.kind, p.points]).sort()).toEqual(
      [
        [ids.c, 'NONPERFORMANCE_FINDING', 15],
        [ids.b, 'VOUCH_LIABILITY', 2], // fixture vouches carry 10% liability: 10% × 20
      ].sort(),
    );
    // No cascade to the voucher's voucher (a).
    expect(penalties.some((p) => p.memberId === ids.a)).toBe(false);
  });

  it('unclear → panel of three; insufficient candidates → NEEDS_REVIEW with frozen credits', async () => {
    const { ex, d } = await disputed();
    const first = (await prisma.attestorAssignment.findFirstOrThrow({ where: { disputeId: d.id } })).attestorId;
    const p = await run(first, after, (tx, ctx) => castVote(tx, ctx, d.id, first, 'UNCLEAR', 'Cannot tell from the evidence provided.'));
    expect(p.status).toBe('PANEL_REVIEW');
    const panel = await prisma.attestorAssignment.findMany({ where: { disputeId: d.id, stage: 2 } });
    expect(panel).toHaveLength(3);
    await run(panel[0].attestorId, after, (tx, ctx) => castVote(tx, ctx, d.id, panel[0].attestorId, 'CONFIRMED', 'The service happened as agreed.'));
    await run(panel[1].attestorId, after, (tx, ctx) => castVote(tx, ctx, d.id, panel[1].attestorId, 'REFUTED', 'I believe the lateness breached terms.'));
    const final = await run(panel[2].attestorId, after, (tx, ctx) => castVote(tx, ctx, d.id, panel[2].attestorId, 'CONFIRMED', 'Arrival time matched the revised plan.'));
    expect(final).toMatchObject({ status: 'RESOLVED', outcome: 'CONFIRMED' });
    // Minority voter is not penalised.
    expect(await prisma.credibilityPenalty.count({ where: { memberId: panel[1].attestorId } })).toBe(0);
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe('SETTLED');

    // New dispute: all four candidates were used once? No — new dispute, fresh pool; make pool too small via leaving.
    const ex2 = await agreed(ids.c, ids.d, 60, addDays(at, 6), { punctualityRequired: true });
    for (const h of ['g', 'h', 'f']) await run(ids[h], addDays(at, 6), (tx, ctx) => leaveCommunity(tx, ctx, ids[h], 'moving away'));
    const when = addHours(addDays(at, 6), 2);
    const d2 = await run(ids.d, when, (tx, ctx) => openDispute(tx, ctx, ids.d, { exchangeId: ex2.id, condition: 'PUNCTUALITY', claim: 'Late again, punctuality agreed.' }));
    const firstAtt = (await prisma.attestorAssignment.findFirstOrThrow({ where: { disputeId: d2.id } })).attestorId;
    const nr = await run(firstAtt, when, (tx, ctx) => castVote(tx, ctx, d2.id, firstAtt, 'UNCLEAR', 'Evidence conflicts; cannot decide.'));
    expect(nr.status).toBe('NEEDS_REVIEW');
    expect(nr.reviewReason).toMatch(/INSUFFICIENT_ATTESTORS/);
    expect(nr.nextAction).toMatch(/will not choose a winner/);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { exchangeId: ex2.id } })).status).toBe('FROZEN');
    // Retrying without new candidates keeps it blocked; mutual agreement resolves it (no penalty).
    const again = await run(ids.c, when, (tx, ctx) => retrySelection(tx, ctx, d2.id, ids.c));
    expect(again.status).toBe('NEEDS_REVIEW');
    await run(ids.c, when, (tx, ctx) => proposeMutual(tx, ctx, d2.id, ids.c, 'REFUTED'));
    const done = await run(ids.d, when, (tx, ctx) => proposeMutual(tx, ctx, d2.id, ids.d, 'REFUTED'));
    expect(done).toMatchObject({ status: 'RESOLVED', outcome: 'REFUTED', outcomeSource: 'mutual agreement' });
    expect((await prisma.reservation.findUniqueOrThrow({ where: { exchangeId: ex2.id } })).status).toBe('RELEASED');
    expect(await prisma.credibilityPenalty.count()).toBe(0);
  });

  it('rejects lateness disputes when punctuality was not agreed', async () => {
    const ex = await agreed(ids.c, ids.d, 60, at, { punctualityRequired: false });
    await expect(run(ids.d, after, (tx, ctx) => openDispute(tx, ctx, ids.d, { exchangeId: ex.id, condition: 'PUNCTUALITY', claim: 'Was 10 minutes late to the session.' }))).rejects.toMatchObject({ code: 'PUNCTUALITY_NOT_AGREED' });
  });
});

describe('invalid transitions', () => {
  it('rejects disputing a settled exchange, cancelling a settled one, and confirming a disputed one', async () => {
    const ex = await agreed(ids.c, ids.d, 60, at);
    await settleBoth(ex.id, ids.c, ids.d, after);
    await expect(run(ids.d, after, (tx, ctx) => openDispute(tx, ctx, ids.d, { exchangeId: ex.id, condition: 'DELIVERABLE', claim: 'Changed my mind after settlement.' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(run(ids.d, after, (tx, ctx) => cancelExchange(tx, ctx, ex.id, ids.d, 'too late'))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    const { ex: ex2 } = await disputed();
    await expect(run(ids.c, after, (tx, ctx) => confirmCompletion(tx, ctx, ex2.id, ids.c))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('withdrawal', () => {
  it('leaving blocks new commitments but preserves accepted obligations, disputes and debts', async () => {
    const ex = await agreed(ids.c, ids.d, 60, at);
    await run(ids.d, T0, (tx, ctx) => leaveCommunity(tx, ctx, ids.d, 'moving'));
    expect((await prisma.member.findUniqueOrThrow({ where: { id: ids.d } })).status).toBe('LEFT');
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe('ACCEPTED');
    await expect(agreed(ids.e, ids.d, 60, addDays(at, 2))).rejects.toMatchObject({ code: 'MEMBER_LEFT' });
    // The existing obligation still settles and the debt remains on record.
    await settleBoth(ex.id, ids.c, ids.d, after);
    expect((await creditSummary(prisma, ids.d, after)).posted).toBe(-100);
    expect(await prisma.vouch.count({ where: { OR: [{ voucherId: ids.d }, { voucheeId: ids.d }], status: 'ACTIVE' } })).toBe(0);
  });

  it('cancellation releases the reservation inside the free window; late cancellation needs both', async () => {
    const ex = await agreed(ids.c, ids.d, 60, addDays(T0, 5));
    await run(ids.d, T0, (tx, ctx) => cancelExchange(tx, ctx, ex.id, ids.d, 'Plans changed'));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { exchangeId: ex.id } })).status).toBe('RELEASED');
    const ex2 = await agreed(ids.c, ids.d, 60, addDays(T0, 5));
    const late = addHours(addDays(T0, 5), -2);
    const req = await run(ids.d, late, (tx, ctx) => cancelExchange(tx, ctx, ex2.id, ids.d, 'Sick'));
    expect(req.status).toBe('ACCEPTED');
    const done = await run(ids.c, late, (tx, ctx) => cancelExchange(tx, ctx, ex2.id, ids.c, 'Agreed'));
    expect(done.status).toBe('CANCELLED');
  });
});

describe('audit trail', () => {
  it('every credit, credibility, vouch and exchange change has a same-transaction audit event', async () => {
    const ex = await agreed(ids.c, ids.d, 60, at);
    await settleBoth(ex.id, ids.c, ids.d, after);
    const actions = (await prisma.auditEvent.findMany({ where: { correlationId: { startsWith: 'test-' } } })).map((a) => a.action);
    for (const a of ['exchange.proposed', 'reservation.created', 'exchange.accepted', 'ledger.settlement', 'reservation.settled', 'exchange.settled', 'vouch.interaction_refreshed', 'credibility.recomputed', 'vouch.activated']) {
      expect(actions).toContain(a);
    }
  });
});
