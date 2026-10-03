import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Db, Tx } from '../../core/db';
import { recordAudit } from '../audit/audit.service';
import { notify, type NotificationIntent } from '../notifications/notification.events';
import { acceptedFriends } from '../trust/trust.friends';
import { loadTrust } from '../trust/trust.service';
import { closestFriends, negativeDays, reconstructNegativeSince, reminderDue } from './negative-balance.rules';

/**
 * Negative-balance periods and close-friend reminders (daily job step 3, AFTER redistribution).
 * Live tracking happens in negative-balance.tracker.ts (called by the ledger on every posting).
 */
const MODULE = 'negative-balance';
const NB = POLICY.negativeBalance;

/**
 * Makes periods consistent with posted balances. Needed once after the migration (members who were
 * already negative get a period reconstructed from ledger history) and as a safety net afterwards.
 */
export async function syncNegativePeriods(tx: Tx, ctx: Ctx) {
  const accounts = await tx.ledgerAccount.findMany({ where: { type: 'MEMBER', memberId: { not: null } }, select: { id: true, memberId: true } });
  const sums = await tx.ledgerEntry.groupBy({ by: ['accountId'], _sum: { amount: true } });
  const posted = new Map(sums.map((s) => [s.accountId, s._sum.amount ?? 0]));
  const open = new Map((await tx.negativeBalancePeriod.findMany({ where: { recoveredAt: null } })).map((p) => [p.memberId, p]));
  let opened = 0;
  let closed = 0;
  for (const a of accounts) {
    const memberId = a.memberId!;
    const balance = posted.get(a.id) ?? 0;
    const period = open.get(memberId);
    if (balance < 0 && !period) {
      const entries = await tx.ledgerEntry.findMany({ where: { accountId: a.id }, select: { amount: true, effectiveAt: true }, orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }] });
      const since = reconstructNegativeSince(entries);
      await tx.negativeBalancePeriod.create({ data: { memberId, negativeSince: since ?? ctx.now, source: since ? 'reconstructed' : 'migration', createdAt: ctx.now } });
      opened++;
    } else if (balance >= 0 && period) {
      await tx.negativeBalancePeriod.update({ where: { id: period.id }, data: { recoveredAt: ctx.now } });
      closed++;
    }
  }
  return { opened, closed };
}

/**
 * For every open period negative for strictly more than POLICY.negativeBalance.reminderAfterDays days
 * and not yet reminded: notify up to N closest accepted friends (strongest relationship first), or the
 * member privately when there is no suitable friend. Once per period (reminderSentAt + dedupe keys).
 * Never mentions the balance, tasks or disputes.
 */
export async function sendNegativeBalanceReminders(tx: Tx, ctx: Ctx) {
  const periods = await tx.negativeBalancePeriod.findMany({ where: { recoveredAt: null, reminderSentAt: null }, include: { member: true }, orderBy: { negativeSince: 'asc' } });
  const due = periods.filter((p) => p.member.status === 'ACTIVE' && reminderDue(p.negativeSince, ctx.now, NB.reminderAfterDays));
  if (!due.length) return { reminded: 0, friendNotifications: 0, privateReminders: 0 };
  const trust = await loadTrust(tx, ctx.now);
  const intents: NotificationIntent[] = [];
  let friendNotifications = 0;
  let privateReminders = 0;
  let reminded = 0;
  for (const p of due) {
    const friends = closestFriends(await acceptedFriends(tx, trust, p.memberId), NB.maxFriendsNotified);
    const recipients = friends.length ? friends.map((f) => f.memberId) : [p.memberId];
    // Claim the period first: a retry (or a concurrent run) finds reminderSentAt set and skips it.
    const claim = await tx.negativeBalancePeriod.updateMany({ where: { id: p.id, reminderSentAt: null }, data: { reminderSentAt: ctx.now, reminderRecipients: recipients } });
    if (claim.count !== 1) continue;
    reminded++;
    const name = p.member.displayName;
    if (friends.length) {
      for (const f of friends) {
        intents.push({
          memberId: f.memberId,
          kind: 'community.friend_opportunity',
          category: 'community',
          title: `${name} could use an opportunity to earn community credits`,
          body: `${name} could use an opportunity to earn community credits. Consider inviting them to help with a task.`,
          link: `/profile/${p.memberId}`,
          entityType: 'MEMBER',
          entityId: p.memberId,
          dedupeKey: `negative-balance:${p.id}:${f.memberId}`,
          at: ctx.now,
        });
        friendNotifications++;
      }
    } else {
      intents.push({
        memberId: p.memberId,
        kind: 'community.private_reminder',
        category: 'community',
        title: 'An opportunity to earn community credits',
        body: `Your posted balance has been below zero for more than ${NB.reminderAfterDays} days. Offering a service on the Service Board is the way to earn credits back. This reminder is private to you.`,
        link: '/services',
        entityType: 'MEMBER',
        entityId: p.memberId,
        dedupeKey: `negative-balance:${p.id}:self`,
        at: ctx.now,
      });
      privateReminders++;
    }
    await recordAudit(tx, ctx, {
      module: MODULE,
      action: 'negative_balance.reminder_sent',
      // SYSTEM entity + no name/balance in the text: the community-wide activity feed must not reveal who is negative.
      entityType: 'SYSTEM',
      entityId: p.id,
      after: { recipients: recipients.length, mode: friends.length ? 'friends' : 'private', negativeDays: Math.floor(negativeDays(p.negativeSince, ctx.now)) },
      reason: `Posted balance negative for more than ${NB.reminderAfterDays} days; ${friends.length ? `${friends.length} closest friend(s) by relationship strength notified` : 'no suitable friend, private reminder sent'}. Once per continuous period.`,
      ruleId: RULES.NEGATIVE_REMINDER,
      summary: friends.length ? `Close-friend opportunity reminder sent to ${friends.length} member(s)` : 'Private credit reminder sent',
    });
  }
  notify(intents);
  return { reminded, friendNotifications, privateReminders };
}

/** The member's own current period (for their Time Credits page / debug). */
export async function myNegativePeriod(db: Db, memberId: string, now: Date) {
  const p = await db.negativeBalancePeriod.findFirst({ where: { memberId, recoveredAt: null } });
  if (!p) return null;
  return { negativeSince: p.negativeSince.toISOString(), days: Math.floor(negativeDays(p.negativeSince, now)), reminderSentAt: p.reminderSentAt?.toISOString() ?? null, source: p.source };
}
