import type { SkillClaim, SkillReview, SkillTier, Member } from '@prisma/client';
import { SERVICE_CATEGORIES, type SkillClaimInput, type SkillClaimView, type SkillTierView } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { lockRow, type Db, type Tx } from '../../core/db';
import { AppError, notFound } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { scoreOf } from '../credibility/credibility.service';
import { assertCanCommit, toSummary } from '../members/member.repo';
import { notify } from '../notifications/notification.events';

const MODULE = 'pricing';
const ORDER: SkillTier[] = ['STANDARD', 'SKILLED', 'ADVANCED', 'SPECIALIST'];
const rank = (t: SkillTier) => ORDER.indexOf(t);

/**
 * How a skill tier is assigned (self-selection never raises a price on its own):
 *  - STANDARD (×1.00): everyone, by default — including members with long records, so nobody's
 *    price rises without their own claim.
 *  - SKILLED (×1.25): a claim with evidence plus one approving peer review.
 *  - ADVANCED (×1.50): a claim with evidence plus one approving peer review.
 *  - SPECIALIST (×2.00): a claim with evidence plus two approving peer reviews.
 * Reviewers: active members with credibility ≥ 40 who are not the claimant and have no declared
 * conflict with them. Any decline closes the claim (the member may claim again with more evidence).
 * Reviewers see the claimant's record in the category (settled services, nonperformance findings)
 * next to the evidence. Reviews and decisions are audited. Credibility says nothing about licences.
 */
export async function effectiveSkillTier(db: Db, memberId: string, category: string): Promise<SkillTierView> {
  const approved = await db.skillClaim.findMany({ where: { memberId, category, status: 'APPROVED' } });
  const best = approved.sort((a, b) => rank(b.tier) - rank(a.tier))[0];
  if (best) {
    return { category, tier: best.tier, multiplierPct: POLICY.pricing.skillTiers[best.tier].multiplierPct, source: 'peer-reviewed', reason: `${best.tier.toLowerCase()} in ${category}: claim approved by peer review on ${best.decidedAt?.toISOString().slice(0, 10)}.` };
  }
  return {
    category,
    tier: 'STANDARD',
    multiplierPct: 100,
    source: 'default',
    reason: `Standard rate: no approved skill claim in ${category}. Self-described skills never raise the price.`,
  };
}

/** The claimant's record in the category, shown to reviewers as evidence. */
export async function categoryRecord(db: Db, memberId: string, category: string) {
  const [settled, findings] = await Promise.all([
    db.exchange.count({ where: { providerId: memberId, category, status: 'SETTLED' } }),
    db.credibilityPenalty.count({ where: { memberId, kind: 'NONPERFORMANCE_FINDING', dispute: { exchange: { category } } } }),
  ]);
  return { settledServices: settled, nonperformanceFindings: findings };
}

export async function effectiveSkillTiers(db: Db, memberId: string): Promise<SkillTierView[]> {
  const out: SkillTierView[] = [];
  for (const c of SERVICE_CATEGORIES) out.push(await effectiveSkillTier(db, memberId, c));
  return out;
}

export async function createSkillClaim(tx: Tx, ctx: Ctx, memberId: string, input: SkillClaimInput) {
  const m = await assertCanCommit(tx, memberId, MODULE);
  await lockRow(tx, 'Member', memberId);
  const pending = await tx.skillClaim.findFirst({ where: { memberId, category: input.category, status: 'PENDING' } });
  if (pending) throw new AppError('CONFLICT', `You already have a pending ${pending.tier.toLowerCase()} claim for ${input.category}.`, MODULE, undefined, 409);
  const current = await effectiveSkillTier(tx, memberId, input.category);
  if (rank(input.tier) <= rank(current.tier)) {
    throw new AppError('VALIDATION_FAILED', `Your ${input.category} tier is already ${current.tier.toLowerCase()} (${current.source}); claim a higher tier.`, MODULE);
  }
  const claim = await tx.skillClaim.create({ data: { memberId, category: input.category, tier: input.tier, evidence: input.evidence, createdAt: ctx.now } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'skill.claimed',
    entityType: 'MEMBER',
    entityId: memberId,
    after: { claimId: claim.id, category: claim.category, tier: claim.tier },
    reason: `Self-claim recorded. It changes no price until ${POLICY.pricing.skillTiers[input.tier].requiredApprovals} peer review(s) approve it.`,
    ruleId: RULES.SKILL_CLAIM,
    summary: `${m.displayName} asked for ${claim.tier.toLowerCase()} in ${claim.category}`,
  });
  return claim;
}

async function reviewBlocker(db: Db, claim: SkillClaim & { reviews: SkillReview[] }, reviewerId: string, now: Date): Promise<string | null> {
  if (claim.status !== 'PENDING') return `This claim is already ${claim.status.toLowerCase()}.`;
  if (claim.memberId === reviewerId) return 'You cannot review your own claim.';
  if (claim.reviews.some((r) => r.reviewerId === reviewerId)) return 'You already reviewed this claim.';
  const reviewer = await db.member.findUnique({ where: { id: reviewerId } });
  if (!reviewer || reviewer.status !== 'ACTIVE') return 'Only active members can review.';
  const conflict = await db.conflictDeclaration.count({
    where: { OR: [{ memberId: reviewerId, otherMemberId: claim.memberId }, { memberId: claim.memberId, otherMemberId: reviewerId }] },
  });
  if (conflict) return 'A conflict of interest is declared between you and the claimant.';
  const score = await scoreOf(db, reviewerId, now);
  if (score < POLICY.pricing.reviewerMinCredibility) return `Reviewers need credibility ≥ ${POLICY.pricing.reviewerMinCredibility} (you have ${score}).`;
  return null;
}

export async function reviewSkillClaim(tx: Tx, ctx: Ctx, claimId: string, reviewerId: string, approve: boolean, note: string) {
  await lockRow(tx, 'SkillClaim', claimId);
  const claim = await tx.skillClaim.findUnique({ where: { id: claimId }, include: { reviews: true, member: true } });
  if (!claim) throw notFound(MODULE, 'Skill claim');
  const blocker = await reviewBlocker(tx, claim, reviewerId, ctx.now);
  if (blocker) throw new AppError('SKILL_REVIEW_NOT_ALLOWED', blocker, MODULE);
  await tx.skillReview.create({ data: { claimId, reviewerId, approve, note, createdAt: ctx.now } });
  const approvals = claim.reviews.filter((r) => r.approve).length + (approve ? 1 : 0);
  const required = POLICY.pricing.skillTiers[claim.tier].requiredApprovals;
  const status = !approve ? 'DECLINED' : approvals >= required ? 'APPROVED' : 'PENDING';
  if (status !== 'PENDING') await tx.skillClaim.update({ where: { id: claimId }, data: { status, decidedAt: ctx.now } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: approve ? 'skill.review_approved' : 'skill.review_declined',
    entityType: 'MEMBER',
    entityId: claim.memberId,
    before: { status: claim.status, approvals: approvals - (approve ? 1 : 0) },
    after: { status, approvals, required, claimId },
    reason: note,
    ruleId: RULES.SKILL_REVIEW,
    summary: `Skill claim ${claim.tier.toLowerCase()} in ${claim.category} for ${claim.member.displayName}: ${approve ? 'approved' : 'declined'} by a reviewer (${status.toLowerCase()})`,
  });
  if (status !== 'PENDING') {
    notify({
      memberId: claim.memberId,
      kind: 'skill.decided',
      category: 'trust',
      title: `Your ${claim.tier.toLowerCase()} claim in ${claim.category} was ${status.toLowerCase()}`,
      body: status === 'APPROVED' ? `New exchanges in ${claim.category} are priced at ×${(POLICY.pricing.skillTiers[claim.tier].multiplierPct / 100).toFixed(2)}. Accepted exchanges keep their locked price.` : `Reviewer note: ${note}`,
      link: '/profile',
      entityType: 'MEMBER',
      entityId: claim.memberId,
      dedupeKey: `skill.decided:${claim.id}`,
      at: ctx.now,
    });
  }
  return status;
}

type ClaimRow = SkillClaim & { member: Member; reviews: (SkillReview & { reviewer: Member })[] };

export async function listSkillClaims(db: Db, viewerId: string, now: Date, filter: { memberId?: string; reviewable?: boolean }) {
  const rows: ClaimRow[] = await db.skillClaim.findMany({
    where: filter.reviewable ? { status: 'PENDING', memberId: { not: viewerId } } : filter.memberId ? { memberId: filter.memberId } : {},
    include: { member: true, reviews: { include: { reviewer: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const out: SkillClaimView[] = [];
  for (const c of rows) {
    const blocker = c.memberId === viewerId ? 'You cannot review your own claim.' : await reviewBlocker(db, c, viewerId, now);
    out.push({
      id: c.id,
      member: toSummary(c.member),
      category: c.category,
      tier: c.tier,
      evidence: c.evidence,
      status: c.status,
      requiredApprovals: POLICY.pricing.skillTiers[c.tier].requiredApprovals,
      approvals: c.reviews.filter((r) => r.approve).length,
      reviews: c.reviews.map((r) => ({ reviewer: toSummary(r.reviewer), approve: r.approve, note: r.note, createdAt: r.createdAt.toISOString() })),
      record: await categoryRecord(db, c.memberId, c.category),
      createdAt: c.createdAt.toISOString(),
      decidedAt: c.decidedAt?.toISOString() ?? null,
      canReview: !blocker,
      cannotReviewReason: blocker,
    });
  }
  return out;
}
