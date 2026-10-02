import type { Listing, Member } from '@prisma/client';
import type { CreateListingInput, ListingView } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Db, Tx } from '../../core/db';
import { AppError, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { scoreOf } from '../credibility/credibility.service';
import { assertCanCommit, toSummary } from '../members/member.repo';
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
  };
}

export async function createListing(tx: Tx, ctx: Ctx, ownerId: string, input: CreateListingInput) {
  const owner = await assertCanCommit(tx, ownerId, MODULE);
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
    data: { ...input, ownerId, createdAt: ctx.now, updatedAt: ctx.now },
    include: { owner: true },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'listing.created',
    entityType: 'LISTING',
    entityId: l.id,
    after: { type: l.type, title: l.title, category: l.category, durationMinutes: l.durationMinutes },
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
  return rows
    .map((l) => {
      const r = reach.get(l.ownerId);
      return { ...toListingView(l), reachability: { reachable: !!r, hops: r?.hops ?? null, strength: r?.strength ?? null } };
    })
    .filter((l) => !f.reachableOnly || l.owner.id === viewerId || l.reachability.reachable)
    .filter((l) => f.maxHops === undefined || l.owner.id === viewerId || (l.reachability.hops ?? Infinity) <= f.maxHops);
}
