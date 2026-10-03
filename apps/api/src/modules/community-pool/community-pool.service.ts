import { formatCredits, type CommunityPoolView } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { lockRow, type Db, type Tx } from '../../core/db';
import { addDayKey, dayKeyOf, zonedTimeUtc } from '../../core/timezone';
import { activityScores } from '../activity/activity.service';
import { recordAudit } from '../audit/audit.service';
import { postedBalance, systemAccount } from '../ledger/ledger.repo';
import { postTransfer } from '../ledger/ledger.service';
import { notify, type NotificationIntent } from '../notifications/notification.events';
import { toDistributionView } from './community-pool.repo';
import { planDistribution, rankAndSelect, recipientCountFor } from './community-pool.rules';

/**
 * Daily redistribution of the Community Credit Pool (daily job step 2, after expiry).
 *
 * Exactly once per date, safe to retry:
 *  - the whole distribution (snapshot row, every grant, every ledger transfer, audit) is ONE transaction;
 *  - PoolDistribution.runDate is unique → a second run for the same date is a no-op (or, if concurrent,
 *    fails on the unique index and rolls back without paying anyone);
 *  - PoolGrant is unique per (distribution, member) and each ledger transfer has the idempotency key
 *    "pool:<date>:<memberId>".
 * Recipients come from the WHOLE eligible community (not friends, not only students).
 */
const MODULE = 'community-pool';
const TZ = POLICY.schedule.timezone;
const CP = POLICY.communityPool;
const c = formatCredits;

export async function distributePool(tx: Tx, ctx: Ctx, runDate: string) {
  const existing = await tx.poolDistribution.findUnique({ where: { runDate } });
  if (existing) return { alreadyDone: true as const, distribution: toDistributionView(existing) };

  const pool = await systemAccount(tx, 'SYSTEM_COMMUNITY_POOL');
  await lockRow(tx, 'LedgerAccount', pool.id);
  const poolBefore = await postedBalance(tx, pool.id);

  // Activity snapshot: the window ends on the day BEFORE the run date (the day that just finished).
  const endDay = addDayKey(runDate, -1);
  const { window, scores } = await activityScores(tx, endDay);
  // Existing account eligibility: ACTIVE members (not left) with a ledger account. Students and non-students alike.
  const eligible = await tx.member.findMany({ where: { status: 'ACTIVE', ledgerAccount: { isNot: null } }, select: { id: true, handle: true, displayName: true } });
  const active = eligible.map((m) => ({ memberId: m.id, points: scores.get(m.id)?.points ?? 0 })).filter((a) => a.points > 0);
  const count = recipientCountFor(active.length, CP.recipientShareNumerator, CP.recipientShareDenominator);
  const seed = `community-pool:${runDate}`;
  const ranked = rankAndSelect(active, count, seed);
  const selected = ranked.filter((r) => r.selected);
  const plan = planDistribution(poolBefore, selected.length, CP.minPaymentUnits);
  const handles = new Map(eligible.map((m) => [m.id, m.handle]));

  const d = await tx.poolDistribution.create({
    data: {
      runDate,
      status: plan.status,
      poolBefore,
      activeUserCount: active.length,
      recipientCount: selected.length,
      paymentPerRecipient: plan.paymentUnits,
      totalPaid: plan.totalPaid,
      remaining: plan.remainingUnits,
      seed,
      windowStart: window.startDay,
      windowEnd: window.endDay,
      inputs: {
        policyVersion: POLICY.version,
        timezone: TZ,
        eligibleMemberCount: eligible.length,
        recipientRule: `ceil(${active.length} × ${CP.recipientShareNumerator} / ${CP.recipientShareDenominator}) = ${count}`,
        formula: 'payment = floor(poolUnits / recipients); remaining = poolUnits − payment × recipients (units = 0.01 credit)',
        tieBreak: `Equal points ordered by a shuffle seeded with "${seed}" over member ids (reproducible).`,
        ranking: ranked.map((r) => ({ ...r, handle: handles.get(r.memberId) })),
      },
      createdAt: ctx.now,
    },
  });

  const intents: NotificationIntent[] = [];
  if (plan.status === 'PAID') {
    for (const r of selected) {
      const txRow = await postTransfer(tx, ctx, {
        kind: 'POOL_DISTRIBUTION',
        idempotencyKey: `pool:${runDate}:${r.memberId}`,
        fromAccountId: pool.id,
        toMemberId: r.memberId,
        amount: plan.paymentUnits,
        explanation: `Community Credit Pool reward for ${runDate}: ${c(poolBefore)} ÷ ${selected.length} recipients, rounded down to ${c(plan.paymentUnits)}. Activity rank ${r.rank} (${r.points} point(s), ${window.startDay}–${window.endDay}).`,
        ruleId: RULES.POOL_DISTRIBUTE,
      });
      await tx.poolGrant.create({ data: { distributionId: d.id, memberId: r.memberId, amount: plan.paymentUnits, rank: r.rank, points: r.points, ledgerTransactionId: txRow.id, createdAt: ctx.now } });
      intents.push({
        memberId: r.memberId,
        kind: 'pool.reward',
        category: 'credits',
        title: `You received ${c(plan.paymentUnits)} credit(s) from the Community Credit Pool`,
        body: `You were one of the ${selected.length} most active members (${r.points} activity point(s), ${window.startDay} to ${window.endDay}). Pool rewards follow the usual rules for received credits and do not earn activity points.`,
        link: '/credits',
        entityType: 'SYSTEM',
        entityId: d.id,
        dedupeKey: `pool.reward:${runDate}:${r.memberId}`,
        at: ctx.now,
      });
    }
  }
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'pool.distributed',
    entityType: 'SYSTEM',
    entityId: d.id,
    before: { poolBefore },
    after: { status: plan.status, recipients: selected.length, paymentPerRecipient: plan.paymentUnits, totalPaid: plan.totalPaid, remaining: plan.remainingUnits },
    reason: toDistributionView(d).explanation,
    ruleId: RULES.POOL_DISTRIBUTE,
    summary:
      plan.status === 'PAID'
        ? `Community pool ${runDate}: ${c(plan.paymentUnits)} to each of ${selected.length} member(s), ${c(plan.remainingUnits)} retained`
        : `Community pool ${runDate}: ${c(poolBefore)} retained (${plan.status === 'RETAINED_NO_ACTIVE_USERS' ? 'no active members' : 'too small to pay 0.01 each'})`,
  });
  notify(intents);
  return { alreadyDone: false as const, distribution: toDistributionView(d) };
}

export function nextRunAt(now: Date): Date {
  const today = dayKeyOf(now, TZ);
  const todayRun = zonedTimeUtc(today, TZ, POLICY.schedule.dailyJobHour);
  return todayRun.getTime() > now.getTime() ? todayRun : zonedTimeUtc(addDayKey(today, 1), TZ, POLICY.schedule.dailyJobHour);
}

export async function communityPoolView(db: Db, memberId: string, now: Date): Promise<CommunityPoolView> {
  const pool = await db.ledgerAccount.findFirst({ where: { type: 'SYSTEM_COMMUNITY_POOL' } });
  const [balance, recent, myGrant] = await Promise.all([
    pool ? postedBalance(db, pool.id) : 0,
    db.poolDistribution.findMany({ orderBy: { runDate: 'desc' }, take: 7 }),
    db.poolGrant.findFirst({ where: { memberId }, orderBy: { createdAt: 'desc' }, include: { distribution: { select: { runDate: true } } } }),
  ]);
  return {
    balance,
    timezone: TZ,
    nextRunAt: nextRunAt(now).toISOString(),
    lastDistribution: recent[0] ? toDistributionView(recent[0]) : null,
    recent: recent.map(toDistributionView),
    myLastGrant: myGrant ? { runDate: myGrant.distribution.runDate, amount: myGrant.amount } : null,
    rules: [
      `Expired credits (after ${POLICY.credits.lotExpiryMonths} months) move into this pool through recorded ledger entries. The pool itself never expires.`,
      `Every day at 00:00 Hong Kong time the server expires due credits, then ranks every eligible member by activity points from the last ${POLICY.activity.windowDays} days (1 point per different person per day; the monthly Friends activity view never changes this).`,
      `The top half of active members (ceil(active ÷ 2)) share the pool equally; each payment is rounded down to 0.01 and every leftover hundredth stays in the pool.`,
      'Equal scores are ordered by a reproducible shuffle seeded with the date. No active members, or less than 0.01 per recipient → the pool is kept for later.',
    ],
  };
}
