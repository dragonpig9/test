import type { PenaltyKind } from '@prisma/client';
import type { CredibilityView, PermissionCheck } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Db, Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { notify } from '../notifications/notification.events';
import { tierPermissions } from '../task-eligibility/eligibility.rules';
import { outgoingCommitmentCount } from '../vouches/vouch.service';
import { gatherInputs } from './credibility.repo';
import { DISCLAIMER, FORMULA_TEXT, computeScore, permissionsFor, type CredibilityResult } from './credibility.rules';

export async function computeCredibility(db: Db, memberId: string, now: Date): Promise<CredibilityResult> {
  return computeScore(await gatherInputs(db, memberId, now));
}

export async function scoreOf(db: Db, memberId: string, now: Date): Promise<number> {
  return (await computeCredibility(db, memberId, now)).score;
}

/** Bootstrap waiver: thresholds for inviting/vouching are waived while the community is tiny. */
export async function bootstrapWaiverActive(db: Db): Promise<boolean> {
  const count = await db.member.count();
  return count < POLICY.bootstrap.waiveThresholdsBelowMembers;
}

export async function permissionsOf(db: Db, memberId: string, now: Date, score?: number): Promise<PermissionCheck[]> {
  const s = score ?? (await scoreOf(db, memberId, now));
  const [waiver, used] = await Promise.all([bootstrapWaiverActive(db), outgoingCommitmentCount(db, memberId, now)]);
  return [...permissionsFor(s, { bootstrapWaiver: waiver, vouchSlotsLeft: POLICY.vouches.maxActiveOutgoing - used }), ...tierPermissions(s)];
}

/**
 * Recomputes scores for the given members and, when a score changed, stores a history
 * snapshot and an audit event in the same transaction as the triggering change.
 */
export async function refreshCredibility(tx: Tx, ctx: Ctx, memberIds: string[], reason: string) {
  for (const memberId of [...new Set(memberIds)]) {
    const result = await computeCredibility(tx, memberId, ctx.now);
    const last = await tx.credibilitySnapshot.findFirst({ where: { memberId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (last && Math.abs(last.score - result.score) < 0.05) continue;
    const snap = await tx.credibilitySnapshot.create({
      data: { memberId, score: result.score, breakdown: JSON.parse(JSON.stringify(result.factors)), reason, createdAt: ctx.now },
    });
    // Newly unlocked task tiers (eligibility is recomputed from the score on every request).
    if (last) {
      for (const [tier, t] of Object.entries(POLICY.taskEligibility.tiers)) {
        if (t.minCredibility > 0 && last.score < t.minCredibility && result.score >= t.minCredibility) {
          notify({
            memberId,
            kind: 'tasks.unlocked',
            category: 'trust',
            title: `${t.label} tasks unlocked`,
            body: `Your credibility rose from ${last.score} to ${result.score} (≥ ${t.minCredibility}), so you can now take ${t.label.toLowerCase()} tasks (${t.examples.toLowerCase()}).${t.requireOwnerApproval ? ' Each one still needs a verified contact method and the owner’s explicit approval.' : ''}`,
            link: '/services',
            entityType: 'CREDIBILITY',
            entityId: memberId,
            dedupeKey: `tasks.unlocked:${memberId}:${tier}:${snap.id}`,
            at: ctx.now,
          });
        }
      }
    }
    await recordAudit(tx, ctx, {
      module: 'credibility',
      action: 'credibility.recomputed',
      entityType: 'CREDIBILITY',
      entityId: memberId,
      before: last ? { score: last.score } : null,
      after: { score: result.score, factors: result.factors.map((f) => ({ key: f.key, points: f.points })) },
      reason,
      ruleId: RULES.CREDIBILITY,
      summary: `Credibility ${last ? `${last.score} → ` : ''}${result.score} (${reason})`,
    });
  }
}

/** Records a penalty from a FINAL documented finding. Never called when a dispute is merely opened. */
export async function applyPenalty(
  tx: Tx,
  ctx: Ctx,
  p: { memberId: string; kind: PenaltyKind; points: number; disputeId?: string; vouchId?: string; finding: string; ruleId: string },
) {
  const row = await tx.credibilityPenalty.create({
    data: {
      memberId: p.memberId,
      kind: p.kind,
      points: p.points,
      disputeId: p.disputeId,
      vouchId: p.vouchId,
      finding: p.finding,
      ruleId: p.ruleId,
      createdAt: ctx.now,
    },
  });
  await recordAudit(tx, ctx, {
    module: 'credibility',
    action: 'credibility.penalty_applied',
    entityType: 'CREDIBILITY',
    entityId: p.memberId,
    after: { penaltyId: row.id, kind: p.kind, points: p.points, disputeId: p.disputeId, vouchId: p.vouchId },
    reason: p.finding,
    ruleId: p.ruleId,
    summary: `Penalty −${p.points} (${p.kind.toLowerCase().replace(/_/g, ' ')}): ${p.finding}`,
  });
  return row;
}

export async function credibilityView(db: Db, memberId: string, now: Date): Promise<CredibilityView> {
  const result = await computeCredibility(db, memberId, now);
  const [snapshots, penalties, permissions] = await Promise.all([
    db.credibilitySnapshot.findMany({ where: { memberId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    db.credibilityPenalty.findMany({ where: { memberId }, orderBy: { createdAt: 'desc' } }),
    permissionsOf(db, memberId, now, result.score),
  ]);
  const history = snapshots.map((s, i) => ({
    id: s.id,
    score: s.score,
    reason: s.reason,
    createdAt: s.createdAt.toISOString(),
    delta: Math.round((s.score - (i > 0 ? snapshots[i - 1].score : 0)) * 10) / 10,
  }));
  return {
    memberId,
    score: result.score,
    factors: result.factors,
    formula: FORMULA_TEXT,
    noHistoryNote:
      'New members start from their incoming vouches only. Factors that need history (completed services, confirmation rate, attestation) start at 0 and are neither rewarded nor penalised until there is a record.',
    permissions,
    history: history.reverse(),
    penalties: penalties.map((p) => ({
      id: p.id,
      kind: p.kind,
      points: p.points,
      finding: p.finding,
      createdAt: p.createdAt.toISOString(),
      disputeId: p.disputeId,
    })),
    disclaimer: DISCLAIMER,
  };
}

export async function assertThreshold(
  db: Db,
  memberId: string,
  now: Date,
  key: PermissionCheck['key'],
  module: string,
): Promise<void> {
  const perms = await permissionsOf(db, memberId, now);
  const p = perms.find((x) => x.key === key)!;
  if (!p.allowed) {
    const limit = p.toUnlock?.startsWith('Vouch limit');
    throw new AppError(limit ? 'VOUCH_LIMIT_REACHED' : 'CREDIBILITY_TOO_LOW', `${p.label} is not available yet. ${p.explanation} ${p.toUnlock ?? ''}`.trim(), module, {
      permission: key,
      threshold: p.threshold,
      current: p.current,
    });
  }
}
