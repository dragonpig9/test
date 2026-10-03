import type { Exchange, Listing, Member, TrustTier } from '@prisma/client';
import type { TaskEligibilityView } from '@commonhours/shared';
import { env } from '../../config/env';
import { RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Db, Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { scoreOf } from '../credibility/credibility.service';
import { contactVerificationOf, getMember } from '../members/member.repo';
import { loadTrust, relationshipTrust, type TrustSnapshot } from '../trust/trust.service';
import { evaluateTaskEligibility } from './eligibility.rules';

const MODULE = 'task-eligibility';

export interface EligibilityQuery {
  provider: Member;
  requester: Member;
  tier: TrustTier;
  category: string;
  minCredibility: number | null;
  minRelationshipTrust: number | null;
  ownerApproval: { approved: boolean } | null;
}

export async function evaluateFor(db: Db, q: EligibilityQuery, now: Date, cache: { trust?: TrustSnapshot; score?: number } = {}): Promise<TaskEligibilityView> {
  const needsRel = !!q.minRelationshipTrust && q.minRelationshipTrust > 0;
  const trust = needsRel ? (cache.trust ?? (await loadTrust(db, now))) : undefined;
  return evaluateTaskEligibility({
    tier: q.tier,
    category: q.category,
    requesterName: q.requester.displayName,
    requesterMinCredibility: q.minCredibility,
    requesterMinRelationshipTrust: q.minRelationshipTrust,
    provider: { name: q.provider.displayName, active: q.provider.status === 'ACTIVE', score: cache.score ?? (await scoreOf(db, q.provider.id, now)), contact: contactVerificationOf(q.provider) },
    relationshipTrust: trust ? relationshipTrust(trust, q.provider.id, q.requester.id) : 0,
    ownerApproval: q.ownerApproval,
    demoMode: env.demoMode,
  });
}

export function homeAccessApproved(ex: Pick<Exchange, 'homeAccessApprovedAt' | 'homeAccessApprovedVersion' | 'termsVersion'>) {
  return !!ex.homeAccessApprovedAt && ex.homeAccessApprovedVersion === ex.termsVersion;
}

/** Eligibility of the provider for an exchange (owner approval evaluated when the tier needs it). */
export async function exchangeEligibility(db: Db, ex: Exchange, now: Date) {
  const [provider, requester] = await Promise.all([getMember(db, ex.providerId), getMember(db, ex.recipientId)]);
  return evaluateFor(
    db,
    { provider, requester, tier: ex.trustTier, category: ex.category, minCredibility: ex.minCredibility, minRelationshipTrust: ex.minRelationshipTrust, ownerApproval: { approved: homeAccessApproved(ex) } },
    now,
  );
}

/**
 * Backend enforcement. Called before a provider proposes/accepts and before any credit reservation,
 * so a direct API request cannot bypass it. `requireApproval` = the final acceptance.
 */
export async function assertTaskEligible(tx: Tx, ctx: Ctx, ex: Exchange, opts: { requireApproval: boolean; stage: string }) {
  const view = await exchangeEligibility(tx, ex, ctx.now);
  const blocking = view.checks.filter((c) => !c.passed && (opts.requireApproval || c.key !== 'ownerApproval'));
  if (blocking.length) {
    const provider = await getMember(tx, ex.providerId);
    throw new AppError(
      'TASK_LOCKED',
      `${provider.displayName} cannot ${opts.stage} this ${view.tierLabel.toLowerCase()} task yet: ${blocking.map((c) => `${c.label} (needs ${c.required}, current ${c.current})`).join('; ')}.` +
        (view.howToBecomeEligible.length ? ` How to become eligible: ${view.howToBecomeEligible.join(' ')}` : ''),
      MODULE,
      { eligibility: view },
    );
  }
  return view;
}

/** Eligibility for listings the viewer could take as provider (requests by others). */
export async function listingEligibility(db: Db, viewer: Member, listings: (Listing & { owner: Member })[], now: Date) {
  const out = new Map<string, TaskEligibilityView>();
  const relevant = listings.filter((l) => l.type === 'REQUEST' && l.ownerId !== viewer.id);
  if (!relevant.length) return out;
  const score = await scoreOf(db, viewer.id, now);
  const trust = relevant.some((l) => (l.minRelationshipTrust ?? 0) > 0) ? await loadTrust(db, now) : undefined;
  for (const l of relevant) {
    out.set(
      l.id,
      await evaluateFor(
        db,
        { provider: viewer, requester: l.owner, tier: l.trustTier, category: l.category, minCredibility: l.minCredibility, minRelationshipTrust: l.minRelationshipTrust, ownerApproval: null },
        now,
        { trust, score },
      ),
    );
  }
  return out;
}

/** Audit record of the explicit owner approval (the eligibility module owns the rule; exchanges store it). */
export async function auditHomeAccess(tx: Tx, ctx: Ctx, ex: Exchange, ownerName: string, providerName: string) {
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'task.home_access_approved',
    entityType: 'EXCHANGE',
    entityId: ex.id,
    after: { termsVersion: ex.termsVersion, approvedBy: ex.recipientId },
    reason: 'Explicit owner approval for entering the home while the owner is absent. Valid only for this terms version.',
    ruleId: RULES.HOME_ACCESS,
    summary: `${ownerName} approved home access for ${providerName} (terms v${ex.termsVersion})`,
  });
}
