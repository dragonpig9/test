import type { Exchange, Member } from '@prisma/client';
import type { ProfileUpdateInput, ProfileView, VerificationStatus } from '@commonhours/shared';
import { RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Db, Tx } from '../../core/db';
import { recordAudit } from '../audit/audit.service';
import { computeCredibility } from '../credibility/credibility.service';
import { getMember, toSummary } from '../members/member.repo';
import { effectiveSkillTiers } from '../pricing/pricing.skills';

const MODULE = 'profiles';

export const PRIVACY_NOTE =
  'Self-reported details are written by the member and not checked. “Verified” appears only after a one-time code was confirmed. Email and phone are private by default; an exact home address is shown only to the provider of an accepted in-home exchange.';

function emailStatus(m: Member, isMe: boolean): VerificationStatus {
  if (m.contactEmailVerifiedAt) {
    return m.contactEmailVerifiedVia === 'email-code'
      ? { status: 'VERIFIED', verifiedAt: m.contactEmailVerifiedAt.toISOString(), note: 'Confirmed with a one-time code sent to this address.' }
      : { status: 'DEMO_VERIFIED', verifiedAt: m.contactEmailVerifiedAt.toISOString(), note: 'Demo only: the code was shown in an on-screen email preview, so ownership of the mailbox was not proven.' };
  }
  return { status: 'UNVERIFIED', verifiedAt: null, note: isMe ? 'Not verified yet. Send yourself a code from Contact verification.' : 'Not verified.' };
}

function phoneStatus(m: Member, isMe: boolean): VerificationStatus {
  if (m.phoneVerifiedAt) return { status: 'VERIFIED', verifiedAt: m.phoneVerifiedAt.toISOString(), note: 'Confirmed with a one-time code.' };
  // Do not reveal to others whether a phone number is on file.
  if (isMe && !m.phone) return { status: 'NOT_PROVIDED', verifiedAt: null, note: 'No phone number on your profile.' };
  return { status: 'UNAVAILABLE', verifiedAt: null, note: 'Phone verification is not available: no SMS provider is configured.' };
}

/** Members with an active (accepted or disputed) exchange together. */
async function activePartners(db: Db, a: string, b: string) {
  const n = await db.exchange.count({
    where: {
      status: { in: ['ACCEPTED', 'DISPUTED'] },
      OR: [
        { providerId: a, recipientId: b },
        { providerId: b, recipientId: a },
      ],
    },
  });
  return n > 0;
}

export async function profileView(db: Db, memberId: string, viewerId: string, now: Date): Promise<ProfileView> {
  const m = await getMember(db, memberId);
  const isMe = memberId === viewerId;
  const [completed, cred, tiers] = await Promise.all([
    db.exchange.count({ where: { providerId: memberId, status: 'SETTLED' } }),
    computeCredibility(db, memberId, now),
    effectiveSkillTiers(db, memberId),
  ]);
  const sharesContact = !isMe && m.shareContactWithPartners && (await activePartners(db, memberId, viewerId));
  return {
    member: toSummary(m),
    isMe,
    selfReported: {
      displayName: m.displayName,
      photoUrl: m.photoUrl,
      intro: m.bio,
      affiliation: m.affiliation,
      neighborhood: m.location,
      languages: m.languages,
      skills: m.skills,
      availability: m.availability,
    },
    verification: { email: emailStatus(m, isMe), phone: phoneStatus(m, isMe) },
    fromRecords: {
      joinedAt: m.joinedAt.toISOString(),
      completedServiceCount: completed,
      credibility: { score: cred.score, factors: cred.factors },
      skillTiers: tiers.filter((t) => t.tier !== 'STANDARD'),
    },
    contact:
      isMe || sharesContact
        ? { email: m.contactEmail ?? m.email, phone: m.phone, visibility: isMe ? (m.shareContactWithPartners ? 'You share this with members you have an active exchange with.' : 'Private: only you can see this.') : 'Shared with you because you have an active exchange together.' }
        : null,
    private: isMe ? { loginEmail: m.email, homeAddress: m.homeAddress, shareContactWithPartners: m.shareContactWithPartners, juryAvailable: m.juryAvailable } : null,
    privacyNote: PRIVACY_NOTE,
  };
}

/**
 * Exact home address of the recipient, only for the provider of an ACCEPTED in-home exchange
 * (restricted or high-trust tier). Never included in notifications or emails.
 */
export async function homeAddressFor(db: Db, ex: Pick<Exchange, 'status' | 'trustTier' | 'providerId' | 'recipientId'>, viewerId: string) {
  if (ex.status !== 'ACCEPTED' || ex.trustTier === 'STANDARD' || viewerId !== ex.providerId) return null;
  const owner = await getMember(db, ex.recipientId);
  return owner.homeAddress ?? null;
}

const trimOrNull = (s: string | undefined) => (s && s.trim() ? s.trim() : null);

/** Self-reported profile editing. Changing the contact email or phone clears its verification. */
export async function updateProfile(tx: Tx, ctx: Ctx, memberId: string, input: ProfileUpdateInput) {
  const m = await getMember(tx, memberId);
  const contactEmail = input.contactEmail === undefined ? m.contactEmail : trimOrNull(input.contactEmail)?.toLowerCase() ?? null;
  const phone = input.phone === undefined ? m.phone : trimOrNull(input.phone);
  const emailChanged = (contactEmail ?? m.email) !== (m.contactEmail ?? m.email);
  const phoneChanged = phone !== m.phone;
  const data = {
    displayName: input.displayName,
    photoUrl: input.photoUrl === undefined ? m.photoUrl : trimOrNull(input.photoUrl),
    bio: input.intro,
    affiliation: input.affiliation,
    location: input.neighborhood,
    languages: input.languages,
    skills: input.skills,
    availability: input.availability,
    contactEmail,
    phone,
    homeAddress: input.homeAddress === undefined ? m.homeAddress : trimOrNull(input.homeAddress),
    shareContactWithPartners: input.shareContactWithPartners,
    juryAvailable: input.juryAvailable,
    profileUpdatedAt: ctx.now,
    ...(emailChanged ? { contactEmailVerifiedAt: null, contactEmailVerifiedVia: null, emailNotifications: false } : {}),
    ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
  };
  const updated = await tx.member.update({ where: { id: memberId }, data });
  // Audit field names only: contact details and addresses never enter the audit trail.
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => k !== 'profileUpdatedAt' && JSON.stringify(m[k as keyof Member]) !== JSON.stringify(updated[k as keyof Member]));
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'profile.updated',
    entityType: 'MEMBER',
    entityId: memberId,
    after: { changedFields: changed },
    reason: `Self-reported profile edited.${emailChanged ? ' Contact email changed: verification cleared and email notifications paused until re-verified.' : ''}${phoneChanged ? ' Phone changed: verification cleared.' : ''}`,
    ruleId: RULES.PROFILE_UPDATE,
    summary: `${updated.displayName} updated their profile (${changed.join(', ') || 'no changes'})`,
  });
  return updated;
}
