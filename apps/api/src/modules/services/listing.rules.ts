import { POLICY } from '../../config/policy';

/** Categories that need a minimum credibility to PROVIDE (community safeguard, not a qualification check). */
export function isRestrictedCategory(category: string): boolean {
  return (POLICY.credibility.restrictedCategories as readonly string[]).includes(category);
}

/** The owner of an OFFER provides; the owner of a REQUEST receives. */
export function listingRoles(type: 'OFFER' | 'REQUEST', ownerId: string, otherId: string) {
  return type === 'OFFER' ? { providerId: ownerId, recipientId: otherId } : { providerId: otherId, recipientId: ownerId };
}
