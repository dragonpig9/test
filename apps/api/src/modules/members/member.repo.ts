import type { Member } from '@prisma/client';
import type { MemberProfile, MemberSummary } from '@commonhours/shared';
import type { Db } from '../../core/db';
import { AppError, notFound } from '../../core/errors';
import { demoBadgeOf, hasGenuineStudentVerification } from '../verification/verification.guards';

type SummaryInput = Pick<Member, 'id' | 'handle' | 'displayName' | 'status' | 'isBootstrap'> &
  Partial<Pick<Member, 'photoUrl' | 'affiliation' | 'location' | 'contactEmailVerifiedAt' | 'contactEmailVerifiedVia' | 'phoneVerifiedAt' | 'university' | 'studentEmailVerifiedAt' | 'studentEmailVerifiedVia' | 'accountType' | 'demoAdmittedAt'>>;

/** Contact verification as a label: only "VERIFIED" when a code was really delivered and confirmed. */
export function contactVerificationOf(m: Partial<Pick<Member, 'contactEmailVerifiedAt' | 'contactEmailVerifiedVia' | 'phoneVerifiedAt'>>) {
  if (m.phoneVerifiedAt || (m.contactEmailVerifiedAt && m.contactEmailVerifiedVia === 'email-code')) return 'VERIFIED' as const;
  if (m.contactEmailVerifiedAt) return 'DEMO_VERIFIED' as const;
  return 'UNVERIFIED' as const;
}

export function toSummary(m: SummaryInput): MemberSummary {
  const base: MemberSummary = { id: m.id, handle: m.handle, displayName: m.displayName, status: m.status, isBootstrap: m.isBootstrap };
  // Only full member rows carry profile basics; selects that omit them keep the v1 shape.
  if (m.affiliation === undefined) return base;
  return {
    ...base,
    photoUrl: m.photoUrl ?? null,
    affiliation: m.affiliation,
    neighborhood: m.location ?? '',
    contactVerification: contactVerificationOf(m),
    university: m.university ?? null,
    // Public flag is true only for a real delivered code ("email-code"), never a development preview.
    universityEmailVerified: hasGenuineStudentVerification({ studentEmailVerifiedAt: m.studentEmailVerifiedAt ?? null, studentEmailVerifiedVia: m.studentEmailVerifiedVia ?? null }),
    demoBadge: demoBadgeOf({
      accountType: m.accountType ?? 'STANDARD',
      demoAdmittedAt: m.demoAdmittedAt ?? null,
      studentEmailVerifiedAt: m.studentEmailVerifiedAt ?? null,
      studentEmailVerifiedVia: m.studentEmailVerifiedVia ?? null,
    }),
  };
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
