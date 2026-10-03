import { describe, expect, it } from 'vitest';
import { UNIVERSITIES, composeStudentEmail, emailSuffixFor, sanitizeEmailLocalPart, studentDetailsSchema, studentEmailProblem } from '@commonhours/shared';
import { DAY_MS } from '../src/core/dates';
import { addDayKey, dayKeyOf, zonedTimeUtc } from '../src/core/timezone';
import { activityWindow, rankByPoints, scoreActivity, type ScoredExchange } from '../src/modules/activity/activity.rules';
import { planDistribution, rankAndSelect, recipientCountFor } from '../src/modules/community-pool/community-pool.rules';
import { currentRun, runsBetween } from '../src/modules/daily-job/daily-job.schedule';
import { closestFriends, periodTransition, reconstructNegativeSince, reminderDue } from '../src/modules/negative-balance/negative-balance.rules';

const HK = 'Asia/Hong_Kong';
const d = (s: string) => new Date(s);

describe('university email domains (shared configuration)', () => {
  it('maps every university to exactly the required suffix', () => {
    expect(Object.fromEntries(UNIVERSITIES.map((u) => [u.code, emailSuffixFor(u.code)]))).toEqual({
      HKU: '@connect.hku.hk',
      CUHK: '@link.cuhk.edu.hk',
      HKUST: '@connect.ust.hk',
      PolyU: '@connect.polyu.hk',
      CityU: '@my.cityu.edu.hk',
      HKBU: '@life.hkbu.edu.hk',
      Lingnan: '@ln.hk',
      EdUHK: '@s.eduhk.hk',
    });
  });

  it('changing the university swaps the suffix and keeps the typed username', () => {
    const typed = 'chantaiman';
    expect(composeStudentEmail('HKU', typed)).toBe('chantaiman@connect.hku.hk');
    expect(composeStudentEmail('CUHK', typed)).toBe('chantaiman@link.cuhk.edu.hk');
  });

  it('never produces a duplicate domain or an extra "@"', () => {
    expect(sanitizeEmailLocalPart('abc@connect.hku.hk')).toBe('abc');
    expect(composeStudentEmail('HKU', 'abc@connect.hku.hk')).toBe('abc@connect.hku.hk');
    expect(composeStudentEmail('HKU', ' abc@@x ')).toBe('abc@connect.hku.hk');
  });

  it('rejects university/domain mismatches and malformed usernames', () => {
    expect(studentEmailProblem('HKU', 'abc@connect.hku.hk')).toBeNull();
    expect(studentEmailProblem('HKU', 'abc@link.cuhk.edu.hk')).toMatch(/must end in @connect.hku.hk/);
    expect(studentEmailProblem('HKU', 'abc@connect.hku.hk@connect.hku.hk')).toMatch(/must not contain|must end/);
    expect(studentEmailProblem('HKU', '.abc@connect.hku.hk')).toMatch(/username/);
    expect(studentEmailProblem('Oxford', 'abc@ox.ac.uk')).toMatch(/Unknown university/);
    const r = studentDetailsSchema.safeParse({ university: 'CityU', studentEmail: 'x@ln.hk', currentStudentDeclaration: true });
    expect(r.success).toBe(false);
    expect(studentDetailsSchema.safeParse({ university: 'CityU', studentEmail: 'x@my.cityu.edu.hk', currentStudentDeclaration: false }).success).toBe(false);
  });
});

describe('Hong Kong calendar days', () => {
  it('uses UTC+8 day boundaries', () => {
    expect(dayKeyOf(d('2026-10-01T15:59:59Z'), HK)).toBe('2026-10-01');
    expect(dayKeyOf(d('2026-10-01T16:00:00Z'), HK)).toBe('2026-10-02');
    expect(zonedTimeUtc('2026-10-02', HK).toISOString()).toBe('2026-10-01T16:00:00.000Z');
    expect(addDayKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('daily job: the run due now, and every 00:00 crossed by a clock jump', () => {
    expect(currentRun(d('2026-10-01T09:00:00Z'), HK, 0)).toEqual({ runDate: '2026-10-01', scheduledFor: d('2026-09-30T16:00:00Z') });
    expect(runsBetween(d('2026-10-01T09:00:00Z'), d('2026-10-02T09:00:00Z'), HK, 0).map((r) => r.runDate)).toEqual(['2026-10-02']);
    expect(runsBetween(d('2026-10-01T09:00:00Z'), d('2026-10-08T09:00:00Z'), HK, 0)).toHaveLength(7);
    // Landing exactly on 00:00 runs it; starting exactly on it does not run it again.
    expect(runsBetween(d('2026-10-01T09:00:00Z'), d('2026-10-01T16:00:00Z'), HK, 0)).toHaveLength(1);
    expect(runsBetween(d('2026-10-01T16:00:00Z'), d('2026-10-01T20:00:00Z'), HK, 0)).toHaveLength(0);
  });
});

describe('activity scoring (one point per distinct counterparty per Hong Kong day)', () => {
  const w = { ...activityWindow('2026-10-07', 7), timezone: HK, pointsPerCounterpartyPerDay: 1, maxPointsPerPairPerWindow: null };
  let n = 0;
  const ex = (a: string, b: string, at: string): ScoredExchange => ({ id: `x${++n}`, providerId: a, recipientId: b, settledAt: d(at) });

  it('repeated exchanges with the same person on the same day earn no extra points', () => {
    const s = scoreActivity([ex('a', 'b', '2026-10-03T02:00:00Z'), ex('b', 'a', '2026-10-03T05:00:00Z'), ex('a', 'b', '2026-10-03T15:00:00Z')], w);
    expect(s.get('a')!.points).toBe(1);
    expect(s.get('b')!.points).toBe(1);
    expect(s.get('a')!.qualifyingExchanges).toBe(3);
  });

  it('the same pair on two HK days, or two people on one day, earn separately', () => {
    // 15:00Z and 17:00Z on Oct 3 are different Hong Kong days (23:00 and 01:00).
    const s = scoreActivity([ex('a', 'b', '2026-10-03T15:00:00Z'), ex('a', 'b', '2026-10-03T17:00:00Z'), ex('a', 'c', '2026-10-03T17:30:00Z')], w);
    expect(s.get('a')!.points).toBe(3);
    expect(s.get('a')!.distinctCounterparties).toBe(2);
    expect(s.get('b')!.points).toBe(2);
    expect(s.get('c')!.points).toBe(1);
  });

  it('ignores exchanges outside the window and applies the pair cap when configured', () => {
    const list = ['2026-09-30T04:00:00Z', '2026-10-01T04:00:00Z', '2026-10-02T04:00:00Z', '2026-10-03T04:00:00Z', '2026-10-08T04:00:00Z'].map((t) => ex('a', 'b', t));
    expect(scoreActivity(list, w).get('a')!.points).toBe(3); // Oct 1–3 inside 1–7
    expect(scoreActivity(list, { ...w, maxPointsPerPairPerWindow: 2 }).get('a')!.points).toBe(2);
  });

  it('ranks with shared ranks for ties', () => {
    const r = rankByPoints([{ n: 'b', points: 2 }, { n: 'a', points: 2 }, { n: 'c', points: 5 }, { n: 'd', points: 0 }], (x) => x.n);
    expect(r.map((x) => [x.n, x.rank])).toEqual([['c', 1], ['a', 2], ['b', 2], ['d', 4]]);
  });
});

describe('exact pool distribution (integer hundredths)', () => {
  it('108 credits / 456 recipients pays 0.23 each = 104.88 and retains 3.12', () => {
    expect(planDistribution(10_800, 456)).toEqual({ status: 'PAID', paymentUnits: 23, totalPaid: 10_488, remainingUnits: 312 });
  });

  it('keeps every unit: paid + remaining = pool', () => {
    for (const [pool, k] of [[1, 1], [999, 7], [10_000, 3], [123_457, 89], [5, 5]]) {
      const p = planDistribution(pool, k);
      expect(p.paymentUnits * k + p.remainingUnits).toBe(pool);
      expect(p.remainingUnits).toBeLessThan(k);
    }
  });

  it('zero recipients and too-small pools retain everything', () => {
    expect(planDistribution(10_800, 0)).toEqual({ status: 'RETAINED_NO_ACTIVE_USERS', paymentUnits: 0, totalPaid: 0, remainingUnits: 10_800 });
    expect(planDistribution(4, 5)).toEqual({ status: 'RETAINED_TOO_SMALL', paymentUnits: 0, totalPaid: 0, remainingUnits: 4 });
    expect(planDistribution(5, 5)).toMatchObject({ status: 'PAID', paymentUnits: 1, remainingUnits: 0 });
    expect(planDistribution(0, 3).status).toBe('RETAINED_TOO_SMALL');
  });

  it('selects ceil(active / 2) recipients (odd counts round up)', () => {
    expect([0, 1, 2, 3, 4, 5, 455, 912].map((n) => recipientCountFor(n))).toEqual([0, 1, 1, 2, 2, 3, 228, 456]);
  });

  it('breaks equal scores with a reproducible date-seeded order', () => {
    const active = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) => ({ memberId: id, points: id === 'm6' ? 9 : 3 }));
    const a = rankAndSelect(active, 3, 'community-pool:2026-10-02');
    const b = rankAndSelect([...active].reverse(), 3, 'community-pool:2026-10-02');
    expect(a).toEqual(b); // input order never matters
    expect(a[0].memberId).toBe('m6'); // higher score always first
    expect(a.filter((x) => x.selected)).toHaveLength(3);
    const orders = new Set(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'].map((day) => rankAndSelect(active, 3, `community-pool:${day}`).map((x) => x.memberId).join()));
    expect(orders.size).toBeGreaterThan(1); // the tie order changes with the date
  });
});

describe('negative balance periods', () => {
  it('opens below zero, survives partial repayment, closes at zero', () => {
    expect(periodTransition(0, -100)).toBe('open');
    expect(periodTransition(-300, -100)).toBe('none'); // partial repayment keeps the timer
    expect(periodTransition(-100, 0)).toBe('close');
    expect(periodTransition(100, 50)).toBe('none');
  });

  it('reconstructs the start of the current negative run from ledger history', () => {
    const e = (amount: number, at: string) => ({ amount, effectiveAt: d(at) });
    expect(reconstructNegativeSince([e(100, '2026-01-01'), e(-300, '2026-02-01'), e(100, '2026-03-01')])).toEqual(d('2026-02-01'));
    expect(reconstructNegativeSince([e(-100, '2026-01-01'), e(100, '2026-02-01'), e(-50, '2026-04-01')])).toEqual(d('2026-04-01'));
    expect(reconstructNegativeSince([e(-100, '2026-01-01'), e(100, '2026-02-01')])).toBeNull();
  });

  it('exactly 50 days does not trigger; more than 50 days does', () => {
    const since = d('2026-01-01T00:00:00Z');
    expect(reminderDue(since, new Date(since.getTime() + 50 * DAY_MS), 50)).toBe(false);
    expect(reminderDue(since, new Date(since.getTime() + 50 * DAY_MS + 1), 50)).toBe(true);
  });

  it('picks at most N friends, strongest first', () => {
    expect(closestFriends([{ id: 'a', strength: 0.9 }, { id: 'b', strength: 0.7 }, { id: 'c', strength: 0.5 }, { id: 'd', strength: 0.4 }], 3).map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });
});
