import type { Member } from '@prisma/client';
import type { MemberProfile, MemberSummary } from '@commonhours/shared';
import type { Db } from '../../core/db';
import { AppError, notFound } from '../../core/errors';

export function toSummary(m: Pick<Member, 'id' | 'handle' | 'displayName' | 'status' | 'isBootstrap'>): MemberSummary {
  return { id: m.id, handle: m.handle, displayName: m.displayName, status: m.status, isBootstrap: m.isBootstrap };
}

export function toProfile(m: Member): MemberProfile {
  return {
    ...toSummary(m),
    bio: m.bio,
    skills: m.skills,
    location: m.location,
    joinedAt: m.joinedAt.toISOString(),
    leftAt: m.leftAt?.toISOString() ?? null,
  };
}

export async function getMember(db: Db, id: string): Promise<Member> {
  const m = await db.member.findUnique({ where: { id } });
  if (!m) throw notFound('members', 'Member');
  return m;
}

/**
 * Leaving blocks NEW commitments (listings, proposals, acceptances, vouches, invitations)
 * but never blocks finishing existing obligations (confirming, disputing, voting).
 */
export async function assertCanCommit(db: Db, memberId: string, module: string): Promise<Member> {
  const m = await getMember(db, memberId);
  if (m.status === 'LEFT') {
    throw new AppError(
      'MEMBER_LEFT',
      `${m.displayName} has left the community, so new commitments are blocked. Existing obligations and disputes can still be completed.`,
      module,
      { memberId },
    );
  }
  return m;
}

export async function listMembers(db: Db): Promise<Member[]> {
  return db.member.findMany({ orderBy: { handle: 'asc' } });
}
