import type { Prisma } from '@prisma/client';
import type { MyBadgesView } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Db, Tx } from '../../core/db';
import { recordAudit } from '../audit/audit.service';
import { monthOf } from '../friends-activity/friends-activity.rules';
import { monthlyScores } from '../friends-activity/friends-activity.service';
import { getMember } from '../members/member.repo';
import { notify } from '../notifications/notification.events';
import { BADGE_DEFINITIONS, communityRegularProgress, monthPeriod, toBadgeView } from './badges.rules';

/**
 * Awards recognition badges. Writes ONLY MemberBadge rows, an audit event and an in-app notification
 * (the small celebration). It never touches the ledger, prices, credibility, relationships or permissions.
 * Idempotent: the (member, kind, period) unique key means a retried settlement or a second evaluation
 * cannot award twice.
 */
const MODULE = 'badges';
const TZ = POLICY.schedule.timezone;

/** Same "qualifying settled exchange" as activity points: settled, positive transfer, no open dispute. */
async function firstQualifyingExchange(db: Db, memberId: string) {
  return db.exchange.findFirst({
    where: {
      status: 'SETTLED',
      settledAmount: { gt: 0 },
      OR: [{ providerId: memberId }, { recipientId: memberId }],
      AND: [{ OR: [{ dispute: null }, { dispute: { status: 'RESOLVED', outcome: 'CONFIRMED' } }] }],
    },
    orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
    select: { id: true, settledAt: true },
  });
}

async function award(tx: Tx, ctx: Ctx, memberId: string, kind: keyof typeof BADGE_DEFINITIONS, period: string, evidence: Prisma.InputJsonValue) {
  const r = await tx.memberBadge.createMany({ data: [{ memberId, kind, period, awardedAt: ctx.now, evidence }], skipDuplicates: true });
  if (r.count !== 1) return false;
  const def = BADGE_DEFINITIONS[kind];
  const m = await getMember(tx, memberId);
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'badge.awarded',
    entityType: 'MEMBER',
    entityId: memberId,
    after: { kind, period, evidence },
    reason: `${def.description} Recognition only: no credits, credibility, trust or privileges change.`,
    ruleId: RULES.BADGE_AWARD,
    summary: `${m.displayName} earned the ${def.label} badge${period === 'once' ? '' : ` (${period})`}`,
  });
  notify({
    memberId,
    kind: 'badge.awarded',
    category: 'community',
    title: `🎉 You earned the ${def.label} badge`,
    body: `${def.description} Badges are recognition only; they do not change credits, credibility or access.`,
    link: '/profile',
    entityType: 'MEMBER',
    entityId: memberId,
    dedupeKey: `badge:${kind}:${period}:${memberId}`,
    at: ctx.now,
  });
  return true;
}

/** Evaluates both badges for these members at ctx.now (Community Regular for the current Hong Kong month). */
export async function evaluateBadges(tx: Tx, ctx: Ctx, memberIds: string[]) {
  const { year, month } = monthOf(ctx.now, TZ);
  const scores = await monthlyScores(tx, year, month);
  const awarded: { memberId: string; kind: string }[] = [];
  for (const memberId of [...new Set(memberIds)]) {
    const first = await firstQualifyingExchange(tx, memberId);
    if (first && (await award(tx, ctx, memberId, 'FIRST_EXCHANGE', 'once', { exchangeId: first.id, settledAt: first.settledAt!.toISOString() }))) {
      awarded.push({ memberId, kind: 'FIRST_EXCHANGE' });
    }
    const credited = scores.points.get(memberId)?.credited ?? [];
    const p = communityRegularProgress(credited, POLICY.badges.communityRegular);
    if (p.earned && (await award(tx, ctx, memberId, 'COMMUNITY_REGULAR', monthPeriod(year, month), { days: p.days, counterparties: p.counterparties }))) {
      awarded.push({ memberId, kind: 'COMMUNITY_REGULAR' });
    }
  }
  return awarded;
}

export async function myBadges(db: Db, memberId: string): Promise<MyBadgesView> {
  const [m, rows] = await Promise.all([getMember(db, memberId), db.memberBadge.findMany({ where: { memberId }, orderBy: { awardedAt: 'asc' } })]);
  return {
    badges: rows.map(toBadgeView),
    showBadges: m.showBadges,
    definitions: Object.entries(BADGE_DEFINITIONS).map(([kind, d]) => ({ kind: kind as keyof typeof BADGE_DEFINITIONS, ...d })),
    note: 'Badges are recognition only. They never create credits, change prices or limits, raise credibility or relationship strength, unlock tasks or grant privileges.',
  };
}

/** Badges for a profile: shown to others only if the member chose to display them. */
export async function profileBadges(db: Db, memberId: string, isMe: boolean, show: boolean) {
  if (!isMe && !show) return null;
  return (await db.memberBadge.findMany({ where: { memberId }, orderBy: { awardedAt: 'asc' } })).map(toBadgeView);
}

export async function setBadgeVisibility(tx: Tx, ctx: Ctx, memberId: string, showBadges: boolean) {
  const m = await getMember(tx, memberId);
  await tx.member.update({ where: { id: memberId }, data: { showBadges } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'badge.visibility',
    entityType: 'MEMBER',
    entityId: memberId,
    before: { showBadges: m.showBadges },
    after: { showBadges },
    reason: 'Member chose whether to display badges on their profile.',
    ruleId: RULES.BADGE_AWARD,
    summary: `${m.displayName} ${showBadges ? 'shows' : 'hides'} their badges`,
  });
}
