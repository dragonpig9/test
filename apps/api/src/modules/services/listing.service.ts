import type { Listing, Member } from '@prisma/client';
import type { CreateListingInput, ListingView } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Db, Tx } from '../../core/db';
import { AppError, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { scoreOf } from '../credibility/credibility.service';
import { assertCanCommit, getMember, toSummary } from '../members/member.repo';
import { estimator } from '../pricing/pricing.service';
import { assertRequesterRequirements, tierMinimum } from '../task-eligibility/eligibility.rules';
import { listingEligibility } from '../task-eligibility/eligibility.service';
import { loadTrust, reachFrom } from '../trust/trust.service';
import { isRestrictedCategory } from './listing.rules';

const MODULE = 'services';

export function toListingView(l: Listing & { owner: Member }): ListingView {
  return {
    id: l.id,
    type: l.type,
    title: l.title,
    description: l.description,
    category: l.category,
    owner: toSummary(l.owner),
    durationMinutes: l.durationMinutes,
    locationType: l.locationType,
    location: l.location,
    availability: l.availability,
    requiredSkills: l.requiredSkills,
    status: l.status,
    createdAt: l.createdAt.toISOString(),
    trustTier: l.trustTier,
    minCredibility: l.minCredibility,
    minRelationshipTrust: l.minRelationshipTrust,
    maxCreditBudget: l.maxCreditBudget,
  };
}

export async function createListing(tx: Tx, ctx: Ctx, ownerId: string, input: CreateListingInput) {
  const owner = await assertCanCommit(tx, ownerId, MODULE);
  // Requests carry the requester's requirements; offers only describe the access level of the service.
  const trustTier = input.trustTier ?? 'STANDARD';
  const requirements =
    input.type === 'REQUEST'
      ? { trustTier, minCredibility: input.minCredibility ?? null, minRelationshipTrust: input.minRelationshipTrust ?? null, maxCreditBudget: input.maxCreditBudget ?? null }
      : { trustTier, minCredibility: null, minRelationshipTrust: null, maxCreditBudget: null };
  if (input.type === 'REQUEST') assertRequesterRequirements(trustTier, input.category, requirements.minCredibility, MODULE);
  if (input.type === 'OFFER' && tierMinimum(trustTier) > 0) {
    const score = await scoreOf(tx, ownerId, ctx.now);
    if (score < tierMinimum(trustTier)) {
      throw new AppError('TASK_LOCKED', `Offering ${trustTier.toLowerCase().replace('_', '-')} services needs credibility ≥ ${tierMinimum(trustTier)} (you have ${score}).`, MODULE, { threshold: tierMinimum(trustTier), current: score });
    }
  }
  if (input.type === 'OFFER' && isRestrictedCategory(input.category)) {
    const score = await scoreOf(tx, ownerId, ctx.now);
    const th = POLICY.credibility.thresholds.restrictedCategory;
    if (score < th) {
      throw new AppError(
        'CATEGORY_RESTRICTED',
        `Offering "${input.category}" requires credibility ≥ ${th} (you have ${score}). This is a community safeguard, not a check of professional qualifications.`,
        MODULE,
        { threshold: th, current: score },
      );
    }
  }
  const l = await tx.listing.create({
    data: { ...input, ...requirements, ownerId, createdAt: ctx.now, updatedAt: ctx.now },
    include: { owner: true },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'listing.created',
    entityType: 'LISTING',
    entityId: l.id,
    after: { type: l.type, title: l.title, category: l.category, durationMinutes: l.durationMinutes, ...requirements },
    reason: 'Member posted a listing.',
    ruleId: RULES.LISTING,
    summary: `${owner.displayName} posted ${l.type === 'OFFER' ? 'an offer' : 'a request'}: ${l.title}`,
  });
  return l;
}

/**
 * Removing a listing never affects exchanges already created from it:
 * a listing and an exchange are separate records.
 */
export async function withdrawListing(tx: Tx, ctx: Ctx, id: string, memberId: string, reason = 'Owner removed the listing.') {
  const l = await tx.listing.findUnique({ where: { id } });
  if (!l) throw notFound(MODULE, 'Listing');
  if (l.ownerId !== memberId) throw forbidden(MODULE, 'Only the owner can remove this listing.');
  if (l.status !== 'OPEN') throw new AppError('INVALID_TRANSITION', `This listing is already ${l.status.toLowerCase()}.`, MODULE);
  const u = await tx.listing.update({ where: { id }, data: { status: 'WITHDRAWN', withdrawnAt: ctx.now, updatedAt: ctx.now }, include: { owner: true } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'listing.withdrawn',
    entityType: 'LISTING',
    entityId: id,
    before: { status: l.status },
    after: { status: u.status },
    reason,
    ruleId: RULES.LISTING,
    summary: `Listing removed: ${l.title}`,
  });
  return u;
}

export async function withdrawAllListings(tx: Tx, ctx: Ctx, memberId: string, reason: string) {
  const open = await tx.listing.findMany({ where: { ownerId: memberId, status: 'OPEN' } });
  for (const l of open) await withdrawListing(tx, ctx, l.id, memberId, reason);
  return open.length;
}

export async function getListing(db: Db, id: string) {
  const l = await db.listing.findUnique({ where: { id }, include: { owner: true } });
  if (!l) throw notFound(MODULE, 'Listing');
  return l;
}

/**
 * Discovery: filter by category/type and optionally by ACTIVE network reachability from the viewer.
 * Reachability and connection strength come from the trust module.
 */
export async function discoverListings(
  db: Db,
  viewerId: string,
  now: Date,
  f: { category?: string; type?: 'OFFER' | 'REQUEST'; reachableOnly?: boolean; mine?: boolean; maxHops?: number; ownerId?: string },
): Promise<ListingView[]> {
  const rows = await db.listing.findMany({
    where: {
      status: 'OPEN',
      ...(f.category ? { category: f.category } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(f.mine ? { ownerId: viewerId } : f.ownerId ? { ownerId: f.ownerId } : {}),
      owner: { status: 'ACTIVE' },
    },
    include: { owner: true },
    orderBy: { createdAt: 'desc' },
  });
  const reach = reachFrom(await loadTrust(db, now), viewerId);
  const viewer = await getMember(db, viewerId);
  const eligibility = await listingEligibility(db, viewer, rows, now);
  const estimate = estimator(db, now);
  const out: ListingView[] = [];
  for (const l of rows) {
    const r = reach.get(l.ownerId);
    const view = { ...toListingView(l), reachability: { reachable: !!r, hops: r?.hops ?? null, strength: r?.strength ?? null } };
    if (f.reachableOnly && l.ownerId !== viewerId && !view.reachability.reachable) continue;
    if (f.maxHops !== undefined && l.ownerId !== viewerId && (view.reachability.hops ?? Infinity) > f.maxHops) continue;
    // Who would provide: the owner of an offer, or the viewer for someone else's request.
    const providerId = l.type === 'OFFER' ? l.ownerId : l.ownerId === viewerId ? null : viewerId;
    out.push({
      ...view,
      eligibility: eligibility.get(l.id) ?? null,
      priceEstimate: providerId ? await estimate(providerId, l.category, l.durationMinutes, l.maxCreditBudget) : null,
    });
  }
  return out;
}
