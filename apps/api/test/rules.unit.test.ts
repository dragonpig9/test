import { describe, expect, it } from 'vitest';
import { floorCheck, newLotAmount, planLotConsumption } from '../src/modules/ledger/ledger.rules';
import { expirableAmount } from '../src/modules/expiry/expiry.rules';
import { buildGraph, shortestPathsFrom } from '../src/modules/trust/trust.graph';
import { effectiveEdge, liabilityMultiplier } from '../src/modules/vouches/vouch.rules';
import { computeScore } from '../src/modules/credibility/credibility.rules';
import { evaluateEligibility, selectAttestors } from '../src/modules/attestation/attestation.eligibility';

const d = (s: string) => new Date(s);

describe('ledger rules', () => {
  it('allows a reservation that lands exactly on the -5 floor and blocks one below it', () => {
    expect(floorCheck(0, 0, 200)).toMatchObject({ available: 0, after: -200, allowed: true });
    expect(floorCheck(-300, 0, 200)).toMatchObject({ after: -500, allowed: true });
    expect(floorCheck(-300, 100, 200)).toMatchObject({ after: -600, allowed: false });
  });

  it('pays off debt before creating a lot', () => {
    expect(newLotAmount(-200, 100)).toBe(100);
    expect(newLotAmount(-200, -50)).toBe(0);
    expect(newLotAmount(100, 300)).toBe(200);
  });

  it('consumes oldest lots first and keeps Σlots = max(posted, 0)', () => {
    const lots = [
      { id: 'b', remaining: 200, earnedAt: d('2026-02-01'), expiresAt: d('2027-02-01') },
      { id: 'a', remaining: 100, earnedAt: d('2026-01-01'), expiresAt: d('2027-01-01') },
    ];
    expect(planLotConsumption(lots, 50)).toEqual([
      { id: 'a', take: 100 },
      { id: 'b', take: 150 },
    ]);
    expect(planLotConsumption(lots, -400)).toEqual([
      { id: 'a', take: 100 },
      { id: 'b', take: 200 },
    ]);
  });
});

describe('expiry rules', () => {
  const lots = [
    { id: 'old', remaining: 300, earnedAt: d('2025-01-01'), expiresAt: d('2026-01-01') },
    { id: 'new', remaining: 100, earnedAt: d('2025-12-01'), expiresAt: d('2026-12-01') },
  ];
  it('expires only lots past their date', () => {
    expect(expirableAmount(lots, 0, d('2026-02-01'))).toBe(300);
    expect(expirableAmount(lots, 0, d('2025-06-01'))).toBe(0);
  });
  it('protects units backing open reservations (oldest first)', () => {
    expect(expirableAmount(lots, 200, d('2026-02-01'))).toBe(100);
    expect(expirableAmount(lots, 500, d('2026-02-01'))).toBe(0);
  });
});

describe('trust graph', () => {
  const members = ['mei', 'alice', 'ben', 'sam', 'zed', 'yan'].map((h) => ({ id: h, handle: h }));
  it('finds Mei → Alice → Ben → Sam with strength 0.49', () => {
    const g = buildGraph(members, [
      { id: 'e1', a: 'alice', b: 'mei', w: 0.7 },
      { id: 'e2', a: 'alice', b: 'ben', w: 1.0 },
      { id: 'e3', a: 'ben', b: 'sam', w: 0.7 },
    ]);
    const p = shortestPathsFrom(g, 'mei').get('sam')!;
    expect(p.nodes).toEqual(['mei', 'alice', 'ben', 'sam']);
    expect(p.hops).toBe(3);
    expect(p.strength).toBeCloseTo(0.49, 10);
  });
  it('breaks equal-length ties by strength, then by handles', () => {
    const g = buildGraph(members, [
      { id: 'e1', a: 'mei', b: 'zed', w: 0.4 },
      { id: 'e2', a: 'zed', b: 'sam', w: 1.0 },
      { id: 'e3', a: 'mei', b: 'yan', w: 0.7 },
      { id: 'e4', a: 'yan', b: 'sam', w: 1.0 },
    ]);
    expect(shortestPathsFrom(g, 'mei').get('sam')!.nodes).toEqual(['mei', 'yan', 'sam']);
    const g2 = buildGraph(members, [
      { id: 'e1', a: 'mei', b: 'zed', w: 0.7 },
      { id: 'e2', a: 'zed', b: 'sam', w: 1.0 },
      { id: 'e3', a: 'mei', b: 'yan', w: 0.7 },
      { id: 'e4', a: 'yan', b: 'sam', w: 1.0 },
    ]);
    expect(shortestPathsFrom(g2, 'mei').get('sam')!.nodes).toEqual(['mei', 'yan', 'sam']);
  });
  it('prefers fewer hops over higher strength (BFS)', () => {
    const g = buildGraph(members, [
      { id: 'e1', a: 'mei', b: 'sam', w: 0.4 },
      { id: 'e2', a: 'mei', b: 'ben', w: 1.0 },
      { id: 'e3', a: 'ben', b: 'sam', w: 1.0 },
    ]);
    expect(shortestPathsFrom(g, 'mei').get('sam')!.hops).toBe(1);
  });
  it('treats expired and revoked edges as absent', () => {
    const base = { strength: 0.7, liabilityPct: 10, activatedAt: d('2025-01-01'), lastInteractionAt: d('2025-01-01'), endReason: null };
    expect(effectiveEdge({ ...base, status: 'ACTIVE', expiresAt: d('2026-07-01') }, d('2026-08-01')).status).toBe('EXPIRED');
    expect(effectiveEdge({ ...base, status: 'REVOKED', expiresAt: d('2027-07-01') }, d('2026-02-01')).effectiveStrength).toBe(0);
    const g = buildGraph(members, [{ id: 'x', a: 'mei', b: 'sam', w: 0 }]);
    expect(shortestPathsFrom(g, 'mei').get('sam')).toBeUndefined();
  });
  it('decays after 12 months without interaction', () => {
    const e = effectiveEdge({ status: 'ACTIVE', strength: 0.4, liabilityPct: 10, activatedAt: d('2025-01-01'), lastInteractionAt: d('2025-01-01'), expiresAt: d('2026-07-01'), endReason: null }, d('2026-02-01'));
    expect(e).toMatchObject({ status: 'ACTIVE', decayed: true, effectiveStrength: 0.2 });
  });
  it('backs strength with liability: backed = min(1, strength × multiplier), then decay', () => {
    const edge = (strength: number, liabilityPct: number, now: Date) =>
      effectiveEdge({ status: 'ACTIVE', strength, liabilityPct, activatedAt: d('2025-01-01'), lastInteractionAt: d('2025-01-01'), expiresAt: d('2026-07-01'), endReason: null }, now);
    expect([10, 20, 30].map(liabilityMultiplier)).toEqual([1.0, 1.2, 1.4]);
    expect(edge(0.7, 10, d('2025-06-01')).effectiveStrength).toBe(0.7);
    expect(edge(0.7, 20, d('2025-06-01')).effectiveStrength).toBe(0.84);
    expect(edge(0.4, 30, d('2025-06-01')).effectiveStrength).toBe(0.56);
    expect(edge(0.7, 30, d('2025-06-01'))).toMatchObject({ backedStrength: 0.98, effectiveStrength: 0.98 });
    expect(edge(1.0, 30, d('2025-06-01')).effectiveStrength).toBe(1);
    expect(edge(0.7, 30, d('2026-02-01'))).toMatchObject({ decayed: true, backedStrength: 0.98, effectiveStrength: 0.49 });
    // Liability stored before the 10/20/30 mapping falls back to the nearest lower tier.
    expect([25, 50, 5].map(liabilityMultiplier)).toEqual([1.2, 1.4, 1]);
  });
});

describe('credibility formula', () => {
  it('is deterministic and explains each factor', () => {
    const r = computeScore({ completedServices: 2, finalizedNonDisputed: 4, timelyConfirmations: 3, incomingStrengthSum: 0.7, incomingVouchCount: 1, bootstrapAllowance: 0, penaltyPoints: 0, votesCast: 1, votesMissed: 0 });
    expect(r.score).toBe(8 + 11.3 + 14 + 3);
    expect(r.factors.map((f) => f.key)).toEqual(['completedServices', 'confirmationRate', 'incomingVouches', 'disputeOutcomes', 'attestation']);
  });
  it('gives no-history members zero for history factors (not a penalty)', () => {
    const r = computeScore({ completedServices: 0, finalizedNonDisputed: 0, timelyConfirmations: 0, incomingStrengthSum: 0.4, incomingVouchCount: 1, bootstrapAllowance: 0, penaltyPoints: 0, votesCast: 0, votesMissed: 0 });
    expect(r.score).toBe(8);
  });
});

describe('attestor eligibility', () => {
  const ctx = {
    parties: [{ id: 'mei', name: 'Mei' }, { id: 'sam', name: 'Sam' }],
    distances: new Map([
      ['mei', new Map([['mei', 0], ['alice', 1], ['priya', 2]])],
      ['sam', new Map([['sam', 0], ['ben', 1], ['priya', 3], ['alice', 2]])],
    ]),
    directRelations: new Map([['alice', ['Mei']]]),
    conflicts: new Map([['kofi', ['Sam']]]),
    alreadySelected: new Set<string>(),
  };
  const c = (id: string, score = 50, status: 'ACTIVE' | 'LEFT' = 'ACTIVE') => ({ id, handle: id, displayName: id, status, score });
  it('excludes parties, close members, direct relations, conflicts, low scores and leavers', () => {
    expect(evaluateEligibility(c('mei'), ctx).eligible).toBe(false);
    expect(evaluateEligibility(c('alice'), ctx).reasons.join()).toMatch(/1 active hop.*Direct voucher/);
    expect(evaluateEligibility(c('kofi'), ctx).reasons).toContain('Declared conflict of interest with Sam');
    expect(evaluateEligibility(c('lena', 10), ctx).reasons[0]).toMatch(/below attestor threshold/);
    expect(evaluateEligibility(c('tom', 50, 'LEFT'), ctx).eligible).toBe(false);
    expect(evaluateEligibility(c('priya'), ctx).eligible).toBe(true);
    expect(evaluateEligibility(c('stranger'), ctx).eligible).toBe(true); // unreachable counts as far enough
  });
  it('selection is reproducible from the recorded seed', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'].map((x) => c(x));
    expect(selectAttestors(pool, 3, 'seed-1')).toEqual(selectAttestors([...pool].reverse(), 3, 'seed-1'));
  });
});
