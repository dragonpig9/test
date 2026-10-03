import type { Db } from '../../core/db';
import type { TrustSnapshot } from './trust.service';

/**
 * "Accepted direct friends" on the existing relationship graph: members directly linked to `memberId`
 * by an ACTIVE (both-consented) vouch in either direction and/or an active earned relationship.
 * Strength = the existing combined pair strength 1 − (1 − vouch)(1 − earned).
 * Excluded: members who left (not in the active graph) and pairs with a declared conflict in either
 * direction (the community's existing "do not connect me with this person" record).
 * Sorted strongest first; ties by handle (deterministic).
 */
export async function acceptedFriends(db: Db, t: TrustSnapshot, memberId: string): Promise<{ memberId: string; strength: number }[]> {
  const adj = t.relGraph.adj.get(memberId) ?? [];
  if (!adj.length) return [];
  const conflicts = await db.conflictDeclaration.findMany({
    where: { OR: [{ memberId }, { otherMemberId: memberId }] },
    select: { memberId: true, otherMemberId: true },
  });
  const blocked = new Set(conflicts.map((c) => (c.memberId === memberId ? c.otherMemberId : c.memberId)));
  const handle = (id: string) => t.relGraph.handles.get(id) ?? id;
  return adj
    .filter(({ to, edge }) => edge.w > 0 && !blocked.has(to))
    .map(({ to, edge }) => ({ memberId: to, strength: edge.w }))
    .sort((a, b) => b.strength - a.strength || (handle(a.memberId) < handle(b.memberId) ? -1 : 1));
}
