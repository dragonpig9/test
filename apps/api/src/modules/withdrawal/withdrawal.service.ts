import { formatCredits } from '@commonhours/shared';
import { RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { lockRow, type Db, type Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { closePendingProposalsFor } from '../exchanges/exchange.service';
import { revokeInvitation } from '../invitations/invitation.service';
import { creditSummary } from '../ledger/ledger.service';
import { getMember } from '../members/member.repo';
import { withdrawAllListings } from '../services/listing.service';
import { endAllVouchesForMember } from '../vouches/vouch.service';

const MODULE = 'withdrawal';

/**
 * What leaving changes and what it keeps. Leaving blocks NEW commitments; it preserves
 * accepted exchanges (which can still be confirmed, cancelled under their terms or disputed),
 * open disputes, attestation duties, debts and the full history.
 */
export async function withdrawalPreview(db: Db, memberId: string, now: Date) {
  const [openListings, proposals, accepted, disputes, assignments, vouches, invitations, credits] = await Promise.all([
    db.listing.count({ where: { ownerId: memberId, status: 'OPEN' } }),
    db.exchange.count({ where: { status: 'PROPOSED', OR: [{ providerId: memberId }, { recipientId: memberId }] } }),
    db.exchange.findMany({ where: { status: { in: ['ACCEPTED', 'DISPUTED'] }, OR: [{ providerId: memberId }, { recipientId: memberId }] }, select: { id: true, deliverable: true, status: true } }),
    db.dispute.count({ where: { status: { not: 'RESOLVED' }, OR: [{ exchange: { providerId: memberId } }, { exchange: { recipientId: memberId } }] } }),
    db.attestorAssignment.count({ where: { attestorId: memberId, status: 'ASSIGNED' } }),
    db.vouch.count({ where: { status: { in: ['ACTIVE', 'PENDING'] }, OR: [{ voucherId: memberId }, { voucheeId: memberId }] } }),
    db.invitation.count({ where: { inviterId: memberId, status: 'OPEN' } }),
    creditSummary(db, memberId, now),
  ]);
  return {
    willClose: [
      `${openListings} open listing(s) will be removed`,
      `${proposals} unaccepted proposal(s) will be withdrawn/declined`,
      `${vouches} active or pending vouch(es) will be revoked going forward (liability for already-accepted exchanges remains)`,
      `${invitations} open invitation(s) will be revoked`,
    ],
    willRemain: [
      `${accepted.length} accepted/disputed exchange(s) remain binding: ${accepted.map((a) => `${a.deliverable} (${a.status})`).join('; ') || 'none'}`,
      `${disputes} open dispute(s) continue`,
      `${assignments} attestation assignment(s) remain yours to complete`,
      `Posted balance ${formatCredits(credits.posted)} stays on record${credits.posted < 0 ? ' — the debt does not disappear' : ''}`,
      'Your history, audit trail and credibility record are preserved',
    ],
    accepted,
    posted: credits.posted,
  };
}

export async function leaveCommunity(tx: Tx, ctx: Ctx, memberId: string, reason: string) {
  await lockRow(tx, 'Member', memberId);
  const m = await getMember(tx, memberId);
  if (m.status === 'LEFT') throw new AppError('ALREADY_DONE', 'You have already left the community.', MODULE, undefined, 409);
  const preview = await withdrawalPreview(tx, memberId, ctx.now);
  await withdrawAllListings(tx, ctx, memberId, 'Owner left the community.');
  await closePendingProposalsFor(tx, ctx, memberId);
  await endAllVouchesForMember(tx, ctx, memberId);
  for (const inv of await tx.invitation.findMany({ where: { inviterId: memberId, status: 'OPEN' } })) {
    await revokeInvitation(tx, ctx, inv.id, memberId);
  }
  const u = await tx.member.update({ where: { id: memberId }, data: { status: 'LEFT', leftAt: ctx.now, leaveReason: reason || null } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'member.left',
    entityType: 'MEMBER',
    entityId: memberId,
    before: { status: m.status },
    after: { status: u.status, preserved: preview.willRemain },
    reason: reason || 'Member chose to leave.',
    ruleId: RULES.WITHDRAW_LEAVE,
    summary: `${m.displayName} left the community; open obligations preserved`,
  });
  return u;
}
