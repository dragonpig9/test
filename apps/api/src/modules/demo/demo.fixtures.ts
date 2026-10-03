import type { PrismaClient } from '@prisma/client';
import type { DemoExpiryLot, DemoExpiryView, DemoFixtureCheck, DemoFloorCheck, DemoSkillReviewCheck } from '@commonhours/shared';
import { formatCredits } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import { makeCtx } from '../../core/context';
import { addDays } from '../../core/dates';
import { withTx, type Db } from '../../core/db';
import { memberAccount, postedBalance, reservationTotals } from '../ledger/ledger.repo';
import { floorCheck, newLotAmount, planLotConsumption } from '../ledger/ledger.rules';
import { toSummary } from '../members/member.repo';
import { proposeExchange } from '../exchanges/exchange.service';
import { createSkillClaim, reviewSkillClaim } from '../pricing/pricing.skills';

/**
 * The records behind "Explore edge cases", found by what they are (never by id), and whether each is still in
 * its initial demonstrable state. Read-only, except `repairDemoFixtures`, which only re-creates a missing
 * record through the ordinary service functions.
 */

type Handle = 'alice' | 'ben' | 'kofi' | 'lena' | 'mei' | 'priya' | 'tomas';
const c = formatCredits;

async function demoMembers(db: Db) {
  const rows = await db.member.findMany({ where: { handle: { in: ['alice', 'ben', 'kofi', 'lena', 'mei', 'priya', 'tomas'] } } });
  return Object.fromEntries(rows.map((m) => [m.handle, m])) as Partial<Record<Handle, (typeof rows)[number]>>;
}

/** Kofi's washing-machine repair for Ben, and what accepting it would do to Ben's available balance now. */
export async function floorExample(db: Db) {
  const { ben, kofi } = await demoMembers(db);
  if (!ben || !kofi) return { exchange: null, check: null };
  const exchange = await db.exchange.findFirst({ where: { providerId: kofi.id, recipientId: ben.id, category: 'Equipment repair' }, orderBy: { createdAt: 'desc' } });
  if (!exchange) return { exchange: null, check: null };
  const acct = await memberAccount(db, ben.id);
  const posted = await postedBalance(db, acct.id);
  const t = await reservationTotals(db, ben.id);
  const cost = exchange.creditAmount + exchange.giftBonus;
  const f = floorCheck(posted, t.outActive + t.outFrozen, cost);
  const check: DemoFloorCheck = {
    exchangeStatus: exchange.status,
    cost,
    availableNow: f.available,
    availableAfter: f.after,
    floor: f.floor,
    wouldBreach: !f.allowed,
    reservations: await db.reservation.count({ where: { exchangeId: exchange.id } }),
  };
  return { exchange, check };
}

/** Approving reviews of Mei's Translation claim, with the reviewer checks (credibility at the time, conflicts). */
export async function skillReviewChecks(db: Db): Promise<DemoSkillReviewCheck[]> {
  const { mei } = await demoMembers(db);
  if (!mei) return [];
  const claim = await db.skillClaim.findFirst({
    where: { memberId: mei.id, category: 'Translation' },
    include: { reviews: { include: { reviewer: true }, orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  if (!claim) return [];
  return Promise.all(
    claim.reviews.map(async (r) => {
      const snap = await db.credibilitySnapshot.findFirst({ where: { memberId: r.reviewerId, createdAt: { lte: r.createdAt } }, orderBy: { createdAt: 'desc' } });
      const conflict = await db.conflictDeclaration.count({
        where: { OR: [{ memberId: r.reviewerId, otherMemberId: mei.id }, { memberId: mei.id, otherMemberId: r.reviewerId }] },
      });
      return {
        reviewer: toSummary(r.reviewer),
        approve: r.approve,
        createdAt: r.createdAt.toISOString(),
        reviewerCredibilityAtReview: snap ? Math.round(snap.score) : null,
        requiredCredibility: POLICY.pricing.reviewerMinCredibility,
        conflictDeclared: conflict > 0,
      };
    }),
  );
}

/**
 * Credit lots of one member with what happened to each, rebuilt from the ledger: lots are replayed in posting
 * order with the same FIFO rules the ledger uses, and every unit a debit consumed is attributed to that debit's
 * kind. If the replay does not reproduce the stored lots exactly, nothing is attributed to expiry (only what the
 * records prove is shown: remaining amounts and the expiry transactions themselves).
 */
export async function expiryView(db: Db, memberId: string, now: Date): Promise<DemoExpiryView> {
  const acct = await memberAccount(db, memberId);
  const lots = await db.creditLot.findMany({ where: { memberId }, orderBy: [{ earnedAt: 'asc' }, { id: 'asc' }] });
  const entries = await db.ledgerEntry.findMany({
    where: { accountId: acct.id },
    include: { transaction: { include: { entries: { include: { account: true } } } } },
  });
  entries.sort(
    (a, b) =>
      a.effectiveAt.getTime() - b.effectiveAt.getTime() ||
      a.transaction.createdAt.getTime() - b.transaction.createdAt.getTime() ||
      (a.transactionId < b.transactionId ? -1 : a.transactionId > b.transactionId ? 1 : 0),
  );

  // Replay.
  const sim = new Map<string, { id: string; earnedAt: Date; expiresAt: Date; remaining: number; expired: number; spent: number; txIds: Set<string> }>();
  const bySource = new Map(lots.map((l) => [l.sourceTransactionId, l]));
  let exact = true;
  let balance = 0;
  for (const e of entries) {
    if (e.amount > 0) {
      const lotAmt = newLotAmount(balance, balance + e.amount);
      if (lotAmt > 0) {
        const lot = bySource.get(e.transactionId);
        if (!lot || lot.originalAmount !== lotAmt) exact = false;
        if (lot) sim.set(lot.id, { id: lot.id, earnedAt: lot.earnedAt, expiresAt: lot.expiresAt, remaining: lotAmt, expired: 0, spent: 0, txIds: new Set() });
      }
    } else if (e.amount < 0) {
      const open = [...sim.values()].filter((l) => l.remaining > 0);
      for (const step of planLotConsumption(open, balance + e.amount)) {
        const l = sim.get(step.id)!;
        l.remaining -= step.take;
        if (e.transaction.kind === 'EXPIRY') {
          l.expired += step.take;
          l.txIds.add(e.transactionId);
        } else l.spent += step.take;
      }
    }
    balance += e.amount;
  }
  for (const l of lots) if (sim.get(l.id)?.remaining !== l.remaining) exact = false;

  // Units backing open reservations are protected (the oldest lots fund reservations first).
  const t = await reservationTotals(db, memberId);
  let protect = t.outActive + t.outFrozen;
  const out: DemoExpiryLot[] = lots.map((l) => {
    const p = Math.min(protect, l.remaining);
    protect -= p;
    const s = exact ? sim.get(l.id) : undefined;
    const expiredAmount = s?.expired ?? 0;
    const spentAmount = s?.spent ?? 0;
    const past = l.expiresAt.getTime() <= now.getTime();
    let state: DemoExpiryLot['state'];
    if (l.remaining > 0) state = p > 0 ? 'protected' : past ? 'due' : 'active';
    else if (!s) state = 'used';
    else state = expiredAmount && spentAmount ? 'mixed' : expiredAmount ? 'expired' : 'spent';
    return {
      id: l.id,
      earnedAt: l.earnedAt.toISOString(),
      expiresAt: l.expiresAt.toISOString(),
      originalAmount: l.originalAmount,
      remaining: l.remaining,
      state,
      expiredAmount,
      spentAmount,
      protectedAmount: p,
      expiryTransactionIds: s ? [...s.txIds] : [],
    };
  });

  const transactions = entries
    .filter((e) => e.transaction.kind === 'EXPIRY')
    .map((e) => {
      const pool = e.transaction.entries.find((x) => x.accountId !== acct.id && x.account.type === 'SYSTEM_COMMUNITY_POOL');
      return { id: e.transactionId, effectiveAt: e.effectiveAt.toISOString(), memberDebit: e.amount, poolCredit: pool?.amount ?? 0, explanation: e.transaction.explanation };
    });
  const next = out.filter((l) => l.remaining - l.protectedAmount > 0 && new Date(l.expiresAt).getTime() > now.getTime())[0];
  return {
    lots: out,
    transactions,
    nextExpiryAt: next?.expiresAt ?? null,
    dueNow: out.filter((l) => l.state === 'due').reduce((s, l) => s + l.remaining, 0),
    attributionExact: exact,
  };
}

/** Whether each edge-case example is ready to demonstrate, was moved on by visitors, or is missing. */
export async function checkDemoFixtures(db: Db, now: Date): Promise<DemoFixtureCheck[]> {
  const m = await demoMembers(db);
  const checks: DemoFixtureCheck[] = [];

  // Home access: Alice's high-trust request, and any offer Mei made for it.
  const cat = m.alice
    ? await db.listing.findFirst({ where: { ownerId: m.alice.id, trustTier: 'HIGH_TRUST' }, orderBy: { createdAt: 'asc' } })
    : null;
  const catEx = m.alice && m.mei
    ? await db.exchange.findFirst({ where: { providerId: m.mei.id, recipientId: m.alice.id, trustTier: 'HIGH_TRUST', status: { notIn: ['DECLINED', 'CANCELLED', 'WITHDRAWN'] } } })
    : null;
  checks.push(
    !cat
      ? { key: 'home', state: 'missing', detail: 'Alice’s high-trust request is not in the demo data.' }
      : catEx
        ? { key: 'home', state: 'changed', detail: `Mei already offered for Alice’s request (exchange ${catEx.status.toLowerCase().replace(/_/g, ' ')}).` }
        : cat.status !== 'OPEN'
          ? { key: 'home', state: 'changed', detail: `Alice’s request is ${cat.status.toLowerCase()}.` }
          : { key: 'home', state: 'ready', detail: 'Alice’s request is open (high trust, owner approval required).' },
  );

  // Skill review: Mei's Translation claim approved by a qualifying, conflict-free reviewer.
  const claim = m.mei ? await db.skillClaim.findFirst({ where: { memberId: m.mei.id, category: 'Translation' }, orderBy: { createdAt: 'desc' } }) : null;
  const reviews = await skillReviewChecks(db);
  const qualifying = reviews.filter((r) => r.approve && !r.conflictDeclared && (r.reviewerCredibilityAtReview ?? 0) >= r.requiredCredibility);
  checks.push(
    !claim
      ? { key: 'skills', state: 'missing', detail: 'Mei has no Translation skill claim.' }
      : claim.status === 'APPROVED' && qualifying.length
        ? { key: 'skills', state: 'ready', detail: `Mei’s ${claim.tier.toLowerCase()} Translation claim was approved by ${qualifying.map((r) => r.reviewer.displayName).join(', ')}.` }
        : { key: 'skills', state: 'changed', detail: `Mei’s Translation claim is ${claim.status.toLowerCase()}.` },
  );

  // Credit floor: Kofi's proposal, and whether accepting it would really breach the floor.
  const f = await floorExample(db);
  checks.push(
    !f.exchange || !f.check
      ? { key: 'floor', state: 'missing', detail: 'Kofi’s repair proposal for Ben is not in the demo data.' }
      : f.exchange.status !== 'PROPOSED'
        ? { key: 'floor', state: 'changed', detail: `Kofi’s proposal is already ${f.exchange.status.toLowerCase().replace(/_/g, ' ')}.` }
        : f.check.wouldBreach
          ? { key: 'floor', state: 'ready', detail: `Ben ${c(f.check.availableNow)} − ${c(f.check.cost)} = ${c(f.check.availableAfter)}, below the floor of ${c(f.check.floor)}.` }
          : { key: 'floor', state: 'changed', detail: `Ben’s balance has changed: ${c(f.check.availableNow)} − ${c(f.check.cost)} = ${c(f.check.availableAfter)} stays within the floor of ${c(f.check.floor)}, so acceptance would be allowed now.` },
  );

  // Too few jurors: the Kofi–Lena kettle dispute with its first UNCLEAR vote.
  const kettle = m.kofi && m.lena
    ? await db.dispute.findFirst({ where: { exchange: { providerId: m.kofi.id, recipientId: m.lena.id } }, include: { assignments: true }, orderBy: { createdAt: 'asc' } })
    : null;
  checks.push(
    !kettle
      ? { key: 'jury', state: 'missing', detail: 'The Kofi–Lena kettle dispute is not in the demo data.' }
      : kettle.status === 'NEEDS_REVIEW' && kettle.assignments.some((a) => a.vote === 'UNCLEAR')
        ? { key: 'jury', state: 'ready', detail: 'The kettle dispute needs review: after an unclear vote, too few eligible jurors remain.' }
        : { key: 'jury', state: 'changed', detail: `The kettle dispute is now ${kettle.status.toLowerCase().replace(/_/g, ' ')}.` },
  );

  // Expiry: processed expiry for Tomás plus a lot that still expires in the future.
  if (!m.tomas) checks.push({ key: 'expiry', state: 'missing', detail: 'Tomás is not in the demo data.' });
  else {
    const v = await expiryView(db, m.tomas.id, now);
    checks.push(
      !v.transactions.length
        ? { key: 'expiry', state: 'missing', detail: 'No expiry has been processed for Tomás.' }
        : v.nextExpiryAt
          ? { key: 'expiry', state: 'ready', detail: `${v.transactions.length} expiry run(s) recorded; next lot expires ${v.nextExpiryAt.slice(0, 10)}.` }
          : { key: 'expiry', state: 'changed', detail: 'All of Tomás’s lots have expired or been spent.' },
    );
  }
  return checks;
}

/**
 * Re-creates edge-case records that are genuinely missing, through the ordinary service functions (no
 * history is rewritten and no balance is set directly). Only examples that can be re-created as new records
 * are repaired: Kofi's proposal for Ben and Mei's Translation claim. History-bound examples (the kettle
 * dispute, Tomás's expired lots) are reported, never fabricated.
 */
export async function repairDemoFixtures(prisma: PrismaClient, now: Date) {
  const m = await demoMembers(prisma);
  const repaired: string[] = [];
  const failed: { key: string; error: string }[] = [];
  const attempt = async (key: DemoFixtureCheck['key'], fn: () => Promise<unknown>) => {
    try {
      await fn();
      repaired.push(key);
    } catch (e) {
      failed.push({ key, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const checks = await checkDemoFixtures(prisma, now);
  const missing = (k: DemoFixtureCheck['key']) => checks.find((x) => x.key === k)?.state === 'missing';
  const ctx = (actor: string, at: Date) => makeCtx(actor, at, `demo-repair-${Date.now()}`);

  if (missing('floor') && m.kofi && m.ben) {
    const listing = await prisma.listing.findFirst({ where: { ownerId: m.ben.id, category: 'Equipment repair', type: 'REQUEST' } });
    await attempt('floor', () => withTx((tx) =>
      proposeExchange(tx, ctx(m.kofi!.id, now), m.kofi!.id, {
        counterpartyId: m.ben!.id,
        myRole: 'provider',
        ...(listing ? { listingId: listing.id } : {}),
        category: 'Equipment repair',
        deliverable: 'Fit the new washing machine door seal and test for leaks',
        durationMinutes: 180,
        scheduledAt: addDays(now, 5).toISOString(),
        location: 'Ben’s flat',
        punctualityRequired: false,
        giftBonus: 0,
        cancellationNoticeHours: 24,
        cancellationTerms: 'Free cancellation up to 24 hours before.',
        confirmationDays: 3,
      }),
    ));
  }
  if (missing('skills') && m.mei && m.priya) {
    await attempt('skills', async () => {
      const claim = await withTx((tx) =>
        createSkillClaim(tx, ctx(m.mei!.id, now), m.mei!.id, { category: 'Translation', tier: 'ADVANCED', evidence: 'HSK 6 certificate; three years translating letters and forms for the university international office.' }),
      );
      await withTx((tx) => reviewSkillClaim(tx, ctx(m.priya!.id, now), claim.id, m.priya!.id, true, 'Saw her HSK 6 certificate and two of her translations; accurate and clear.'));
    });
  }
  return { repaired, failed, checks: repaired.length ? await checkDemoFixtures(prisma, now) : checks };
}
