import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { CreateInvitationInput, InvitationView, JoinInput } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { addDays } from '../../core/dates';
import { lockRow, type Db, type Tx } from '../../core/db';
import { AppError, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { assertThreshold } from '../credibility/credibility.service';
import { ensureMemberAccount } from '../ledger/ledger.repo';
import { assertCanCommit, toSummary } from '../members/member.repo';
import { notify } from '../notifications/notification.events';
import { maxPenaltyPoints, vouchTermsText } from '../vouches/vouch.rules';
import { createVouchFromInvitation } from '../vouches/vouch.service';

const MODULE = 'invitations';

export const COMMUNITY_TERMS = [
  'Membership is invite-only. Your inviter vouches for you and accepts a bounded credibility liability.',
  'Every hour of service is worth one time credit, whatever the service. Credits cannot be bought, sold or converted to cash.',
  'Before work starts, both members agree the terms: who provides what, duration, time, punctuality, credits, gift bonus, cancellation and confirmation deadline.',
  'Disagreements are judged only against the terms agreed before the service, by randomly selected community attestors.',
  'You may leave at any time; open obligations, disputes and history remain.',
];

function newCode() {
  return randomBytes(5).toString('hex').toUpperCase();
}

export function toInvitationView(inv: {
  id: string;
  code: string;
  inviter: Parameters<typeof toSummary>[0];
  inviteeName: string;
  strength: number;
  liabilityPct: number;
  status: InvitationView['status'];
  createdAt: Date;
  expiresAt: Date;
}): InvitationView {
  return {
    id: inv.id,
    code: inv.code,
    inviter: toSummary(inv.inviter),
    inviteeName: inv.inviteeName,
    strength: inv.strength,
    liabilityPct: inv.liabilityPct,
    maxPenaltyPoints: maxPenaltyPoints(inv.liabilityPct),
    status: inv.status,
    createdAt: inv.createdAt.toISOString(),
    expiresAt: inv.expiresAt.toISOString(),
    terms: [...COMMUNITY_TERMS, ...vouchTermsText(inv.strength, inv.liabilityPct)],
  };
}

export async function createInvitation(tx: Tx, ctx: Ctx, inviterId: string, input: CreateInvitationInput, code?: string) {
  const inviter = await assertCanCommit(tx, inviterId, MODULE);
  await lockRow(tx, 'Member', inviterId); // serialize vouch-limit checks
  await assertThreshold(tx, inviterId, ctx.now, 'invite', MODULE);
  const inv = await tx.invitation.create({
    data: {
      code: code ?? newCode(),
      inviterId,
      inviteeName: input.inviteeName,
      strength: input.strength,
      liabilityPct: input.liabilityPct,
      termsVersion: POLICY.vouches.termsVersion,
      createdAt: ctx.now,
      expiresAt: addDays(ctx.now, POLICY.vouches.invitationValidDays),
    },
    include: { inviter: true },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'invitation.created',
    entityType: 'INVITATION',
    entityId: inv.id,
    after: { inviteeName: inv.inviteeName, strength: inv.strength, liabilityPct: inv.liabilityPct, expiresAt: inv.expiresAt },
    reason: `Inviter consented to vouch at strength ${inv.strength} with liability ${inv.liabilityPct}% (max penalty ${maxPenaltyPoints(inv.liabilityPct)} points).`,
    ruleId: RULES.INVITE_CREATE,
    summary: `${inviter.displayName} invited ${inv.inviteeName}`,
  });
  return inv;
}

export async function previewInvitation(db: Db, code: string, now: Date) {
  const inv = await db.invitation.findUnique({ where: { code: code.trim().toUpperCase() }, include: { inviter: true } });
  if (!inv) throw new AppError('INVITATION_INVALID', 'No invitation exists with this code.', MODULE);
  if (inv.status !== 'OPEN' || inv.expiresAt <= now) {
    throw new AppError('INVITATION_INVALID', `This invitation is ${inv.status === 'OPEN' ? 'expired' : inv.status.toLowerCase()}.`, MODULE);
  }
  if (inv.inviter.status !== 'ACTIVE') throw new AppError('INVITATION_INVALID', 'The inviter has left the community; ask another member.', MODULE);
  return inv;
}

export async function revokeInvitation(tx: Tx, ctx: Ctx, id: string, memberId: string) {
  const inv = await tx.invitation.findUnique({ where: { id } });
  if (!inv) throw notFound(MODULE, 'Invitation');
  if (inv.inviterId !== memberId) throw forbidden(MODULE, 'Only the inviter can revoke this invitation.');
  if (inv.status !== 'OPEN') throw new AppError('INVALID_TRANSITION', `This invitation is already ${inv.status.toLowerCase()}.`, MODULE);
  const u = await tx.invitation.update({ where: { id }, data: { status: 'REVOKED' } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'invitation.revoked',
    entityType: 'INVITATION',
    entityId: id,
    before: { status: inv.status },
    after: { status: u.status },
    reason: 'Inviter revoked the unused invitation.',
    ruleId: RULES.INVITE_CREATE,
    summary: `Invitation for ${inv.inviteeName} revoked`,
  });
  return u;
}

/**
 * Joining: the invitee must accept the community terms and the vouch terms.
 * Only then is the member created and the inviter's vouch activated (both consents present).
 */
export async function joinWithInvitation(tx: Tx, ctx: Ctx, input: JoinInput, opts: { passwordHash?: string } = {}) {
  if (!input.acceptCommunityTerms || !input.acceptVouchTerms) {
    throw new AppError('TERMS_NOT_ACCEPTED', 'You must accept the community terms and the vouch terms to join.', MODULE);
  }
  const inv = await previewInvitation(tx, input.code, ctx.now);
  await lockRow(tx, 'Member', inv.inviterId);
  const clash = await tx.member.findFirst({ where: { OR: [{ email: input.email.toLowerCase() }, { handle: input.handle }] } });
  if (clash) throw new AppError('CONFLICT', 'That email or handle is already registered.', MODULE, undefined, 409);
  const member = await tx.member.create({
    data: {
      handle: input.handle,
      displayName: input.displayName,
      email: input.email.toLowerCase(),
      passwordHash: opts.passwordHash ?? (await bcrypt.hash(input.password, 10)),
      joinedAt: ctx.now,
    },
  });
  const memberCtx = { ...ctx, actorId: member.id };
  await ensureMemberAccount(tx, member.id, member.displayName);
  await tx.invitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED', acceptedById: member.id, acceptedAt: ctx.now } });
  await recordAudit(tx, memberCtx, {
    module: MODULE,
    action: 'member.joined',
    entityType: 'MEMBER',
    entityId: member.id,
    after: { handle: member.handle, invitedBy: inv.inviter.handle, termsVersion: inv.termsVersion },
    reason: 'Accepted community terms and vouch terms via invitation.',
    ruleId: RULES.JOIN,
    summary: `${member.displayName} joined, invited by ${inv.inviter.displayName}`,
  });
  await createVouchFromInvitation(tx, memberCtx, inv, member.id);
  notify({
    memberId: inv.inviterId,
    kind: 'invitation.accepted',
    category: 'invitations',
    title: `${member.displayName} joined with your invitation`,
    body: `Your vouch (strength ${inv.strength}, liability ${inv.liabilityPct}%) is now active.`,
    link: '/trust?tab=vouches',
    entityType: 'MEMBER',
    entityId: member.id,
    dedupeKey: `invitation.accepted:${inv.id}`,
    at: ctx.now,
  });
  return member;
}

export async function listInvitations(db: Db, inviterId: string) {
  return db.invitation.findMany({ where: { inviterId }, include: { inviter: true }, orderBy: { createdAt: 'desc' } });
}
