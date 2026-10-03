import type { Vouch } from '@prisma/client';
import type { AmendVouchInput, ProposeVouchInput, VouchAmendmentView } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { lockRow, type Db, type Tx } from '../../core/db';
import { AppError, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { assertThreshold, refreshCredibility } from '../credibility/credibility.service';
import { assertCanCommit } from '../members/member.repo';
import { notify } from '../notifications/notification.events';
import { effectiveEdge, maxPenaltyPoints, nextStrengthUp, refreshedExpiry } from './vouch.rules';

const MODULE = 'vouches';

function snapshot(v: Vouch) {
  return {
    status: v.status,
    strength: v.strength,
    liabilityPct: v.liabilityPct,
    lastInteractionAt: v.lastInteractionAt,
    expiresAt: v.expiresAt,
  };
}

/**
 * Counts commitments against the finite vouch limit: effectively-active and pending outgoing
 * vouches plus open (unexpired) invitations.
 */
export async function outgoingCommitmentCount(db: Db, memberId: string, now: Date): Promise<number> {
  const [vouches, invites] = await Promise.all([
    db.vouch.findMany({ where: { voucherId: memberId, status: { in: ['ACTIVE', 'PENDING'] } } }),
    db.invitation.count({ where: { inviterId: memberId, status: 'OPEN', expiresAt: { gt: now } } }),
  ]);
  const live = vouches.filter((v) => v.status === 'PENDING' || effectiveEdge(v, now).status === 'ACTIVE').length;
  return live + invites;
}

async function liveVouchBetween(db: Db, voucherId: string, voucheeId: string, now: Date) {
  const rows = await db.vouch.findMany({ where: { voucherId, voucheeId, status: { in: ['ACTIVE', 'PENDING'] } } });
  return rows.find((v) => v.status === 'PENDING' || effectiveEdge(v, now).status === 'ACTIVE') ?? null;
}

/** Creates an ACTIVE vouch from an accepted invitation (both consents already given). */
export async function createVouchFromInvitation(
  tx: Tx,
  ctx: Ctx,
  inv: { id: string; inviterId: string; strength: number; liabilityPct: number; termsVersion: string; createdAt: Date },
  voucheeId: string,
) {
  const v = await tx.vouch.create({
    data: {
      voucherId: inv.inviterId,
      voucheeId,
      strength: inv.strength,
      liabilityPct: inv.liabilityPct,
      status: 'ACTIVE',
      origin: 'INVITATION',
      invitationId: inv.id,
      termsVersion: inv.termsVersion,
      createdAt: ctx.now,
      voucherConsentAt: inv.createdAt,
      voucheeConsentAt: ctx.now,
      activatedAt: ctx.now,
      lastInteractionAt: ctx.now,
      expiresAt: refreshedExpiry(ctx.now),
    },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'vouch.activated',
    entityType: 'VOUCH',
    entityId: v.id,
    before: null,
    after: snapshot(v),
    reason: 'Invitee accepted the community and vouch terms; inviter consented when issuing the invitation.',
    ruleId: RULES.JOIN,
    summary: `Vouch activated from invitation (strength ${v.strength}, liability ${v.liabilityPct}%)`,
  });
  await refreshCredibility(tx, ctx, [voucheeId], 'new incoming vouch');
  return v;
}

export async function proposeVouch(tx: Tx, ctx: Ctx, voucherId: string, input: ProposeVouchInput) {
  if (voucherId === input.voucheeId) throw new AppError('VOUCH_NOT_ALLOWED', 'You cannot vouch for yourself.', MODULE);
  await assertCanCommit(tx, voucherId, MODULE);
  const vouchee = await assertCanCommit(tx, input.voucheeId, MODULE);
  await lockRow(tx, 'Member', voucherId); // serialize limit checks for this voucher
  if (await liveVouchBetween(tx, voucherId, input.voucheeId, ctx.now)) {
    throw new AppError('VOUCH_EXISTS', `You already have an active or pending vouch for ${vouchee.displayName}. Propose an amendment instead.`, MODULE);
  }
  await assertThreshold(tx, voucherId, ctx.now, 'vouch', MODULE);
  const v = await tx.vouch.create({
    data: {
      voucherId,
      voucheeId: input.voucheeId,
      strength: input.strength,
      liabilityPct: input.liabilityPct,
      status: 'PENDING',
      origin: 'DIRECT',
      termsVersion: POLICY.vouches.termsVersion,
      createdAt: ctx.now,
      voucherConsentAt: ctx.now,
    },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'vouch.proposed',
    entityType: 'VOUCH',
    entityId: v.id,
    after: snapshot(v),
    reason: `Voucher consented to strength ${v.strength} and liability ${v.liabilityPct}% (max penalty ${maxPenaltyPoints(v.liabilityPct)} points).`,
    ruleId: RULES.VOUCH_PROPOSE,
    summary: `Vouch proposed for ${vouchee.displayName}; waiting for their consent`,
  });
  const voucher = await tx.member.findUniqueOrThrow({ where: { id: voucherId } });
  notify({
    memberId: vouchee.id,
    kind: 'vouch.requested',
    category: 'invitations',
    title: `${voucher.displayName} wants to vouch for you`,
    body: `Strength ${v.strength}, liability ${v.liabilityPct}% (their maximum penalty ${maxPenaltyPoints(v.liabilityPct)} points). It only becomes active if you accept.`,
    link: '/trust?tab=vouches',
    entityType: 'VOUCH',
    entityId: v.id,
    dedupeKey: `vouch.requested:${v.id}`,
    at: ctx.now,
  });
  return v;
}

async function getVouch(db: Db, id: string) {
  const v = await db.vouch.findUnique({ where: { id }, include: { voucher: true, vouchee: true } });
  if (!v) throw notFound(MODULE, 'Vouch');
  return v;
}

export async function respondToVouch(tx: Tx, ctx: Ctx, vouchId: string, memberId: string, accept: boolean) {
  await lockRow(tx, 'Vouch', vouchId);
  const v = await getVouch(tx, vouchId);
  if (v.voucheeId !== memberId) throw forbidden(MODULE, 'Only the vouched member can accept or decline this vouch.');
  if (v.status !== 'PENDING') throw new AppError('INVALID_TRANSITION', `This vouch is already ${v.status.toLowerCase()}.`, MODULE);
  if (accept) await assertCanCommit(tx, memberId, MODULE);
  const updated = await tx.vouch.update({
    where: { id: vouchId },
    data: accept
      ? { status: 'ACTIVE', voucheeConsentAt: ctx.now, activatedAt: ctx.now, lastInteractionAt: ctx.now, expiresAt: refreshedExpiry(ctx.now) }
      : { status: 'DECLINED', endedAt: ctx.now, endReason: 'declined by vouchee' },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: accept ? 'vouch.activated' : 'vouch.declined',
    entityType: 'VOUCH',
    entityId: vouchId,
    before: snapshot(v),
    after: snapshot(updated),
    reason: accept ? 'Vouchee consented to the vouch terms.' : 'Vouchee declined.',
    ruleId: RULES.VOUCH_ACCEPT,
    summary: `${v.vouchee.displayName} ${accept ? 'accepted' : 'declined'} ${v.voucher.displayName}'s vouch`,
  });
  notify({
    memberId: v.voucherId,
    kind: accept ? 'vouch.accepted' : 'vouch.declined',
    category: 'invitations',
    title: `${v.vouchee.displayName} ${accept ? 'accepted' : 'declined'} your vouch`,
    body: accept ? `Your vouch (strength ${v.strength}, liability ${v.liabilityPct}%) is now active.` : 'Nothing changed; no liability applies.',
    link: '/trust?tab=vouches',
    entityType: 'VOUCH',
    entityId: v.id,
    dedupeKey: `vouch.responded:${v.id}`,
    at: ctx.now,
  });
  if (accept) await refreshCredibility(tx, ctx, [v.voucheeId], 'new incoming vouch');
  return updated;
}

/**
 * Either party may revoke. Revocation stops the edge from counting for reachability and
 * credibility going forward. It does NOT erase liability for exchanges accepted while the
 * vouch was active — those use the liability snapshot stored on the exchange.
 */
export async function revokeVouch(tx: Tx, ctx: Ctx, vouchId: string, memberId: string, reason: string, ruleId: string = RULES.VOUCH_REVOKE) {
  await lockRow(tx, 'Vouch', vouchId);
  const v = await getVouch(tx, vouchId);
  if (v.voucherId !== memberId && v.voucheeId !== memberId) throw forbidden(MODULE, 'Only the two members on this vouch can revoke it.');
  if (v.status !== 'ACTIVE' && v.status !== 'PENDING') {
    throw new AppError('INVALID_TRANSITION', `This vouch is already ${v.status.toLowerCase()}.`, MODULE);
  }
  const updated = await tx.vouch.update({ where: { id: vouchId }, data: { status: 'REVOKED', endedAt: ctx.now, endReason: reason } });
  await tx.vouchAmendment.updateMany({ where: { vouchId, status: 'PENDING' }, data: { status: 'DECLINED', decidedAt: ctx.now } });
  const open = await tx.exchange.count({
    where: { status: { in: ['ACCEPTED', 'DISPUTED'] }, OR: [{ providerId: v.voucheeId }, { recipientId: v.voucheeId }] },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'vouch.revoked',
    entityType: 'VOUCH',
    entityId: vouchId,
    before: snapshot(v),
    after: snapshot(updated),
    reason: `${reason}${open ? ` — liability for ${open} exchange(s) already accepted remains in force.` : ''}`,
    ruleId,
    summary: `Vouch ${v.voucher.displayName} → ${v.vouchee.displayName} revoked`,
  });
  await refreshCredibility(tx, ctx, [v.voucheeId], 'incoming vouch revoked');
  return updated;
}

/**
 * Amendments change strength and/or liability and always need the counterparty's fresh consent.
 * Strengthening rule: one level at a time, and only after at least one SETTLED exchange between
 * the two members since the vouch was activated. Raising liability is consent the VOUCHER must
 * give freshly — either by proposing it or by accepting the vouchee's proposal.
 */
export async function proposeAmendment(tx: Tx, ctx: Ctx, vouchId: string, memberId: string, input: AmendVouchInput) {
  await lockRow(tx, 'Vouch', vouchId);
  const v = await getVouch(tx, vouchId);
  if (v.voucherId !== memberId && v.voucheeId !== memberId) throw forbidden(MODULE, 'Only the two members on this vouch can amend it.');
  if (effectiveEdge(v, ctx.now).status !== 'ACTIVE') throw new AppError('INVALID_TRANSITION', 'Only active vouches can be amended.', MODULE);
  await assertCanCommit(tx, memberId, MODULE);
  if (input.strength === v.strength && input.liabilityPct === v.liabilityPct) {
    throw new AppError('VALIDATION_FAILED', 'The amendment does not change anything.', MODULE);
  }
  if (input.strength > v.strength) {
    const up = nextStrengthUp(v.strength);
    if (up === null || Math.abs(up - input.strength) > 1e-9) {
      throw new AppError('STRENGTHEN_NOT_ALLOWED', `Strength can only rise one level at a time (${v.strength} → ${up ?? 'max'}).`, MODULE);
    }
    const settled = await tx.exchange.count({
      where: {
        status: 'SETTLED',
        settledAt: { gte: v.activatedAt ?? v.createdAt },
        OR: [
          { providerId: v.voucherId, recipientId: v.voucheeId },
          { providerId: v.voucheeId, recipientId: v.voucherId },
        ],
      },
    });
    if (settled < POLICY.vouches.strengthenRequiresSettledExchanges) {
      throw new AppError(
        'STRENGTHEN_NOT_ALLOWED',
        `Strengthening needs at least ${POLICY.vouches.strengthenRequiresSettledExchanges} settled exchange between ${v.voucher.displayName} and ${v.vouchee.displayName} since the vouch started (found ${settled}). A successful exchange never strengthens a vouch automatically.`,
        MODULE,
      );
    }
  }
  const pending = await tx.vouchAmendment.findFirst({ where: { vouchId, status: 'PENDING' } });
  if (pending) throw new AppError('CONFLICT', 'There is already a pending amendment for this vouch.', MODULE);
  const a = await tx.vouchAmendment.create({
    data: {
      vouchId,
      proposedById: memberId,
      fromStrength: v.strength,
      toStrength: input.strength,
      fromLiabilityPct: v.liabilityPct,
      toLiabilityPct: input.liabilityPct,
      createdAt: ctx.now,
    },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'vouch.amendment_proposed',
    entityType: 'VOUCH',
    entityId: vouchId,
    before: snapshot(v),
    after: { proposed: { strength: input.strength, liabilityPct: input.liabilityPct } },
    reason: 'Amendment requires the counterparty’s consent.',
    ruleId: RULES.VOUCH_AMEND,
    summary: `Amendment proposed: strength ${v.strength}→${input.strength}, liability ${v.liabilityPct}%→${input.liabilityPct}%`,
  });
  const proposer = memberId === v.voucherId ? v.voucher : v.vouchee;
  notify({
    memberId: memberId === v.voucherId ? v.voucheeId : v.voucherId,
    kind: 'vouch.amendment_requested',
    category: 'invitations',
    title: `${proposer.displayName} proposed a change to your vouch`,
    body: `Strength ${v.strength} → ${input.strength}, liability ${v.liabilityPct}% → ${input.liabilityPct}%. Nothing changes unless you accept.`,
    link: '/trust?tab=vouches',
    entityType: 'VOUCH',
    entityId: v.id,
    dedupeKey: `vouch.amendment:${a.id}`,
    at: ctx.now,
  });
  return a;
}

export async function respondToAmendment(tx: Tx, ctx: Ctx, amendmentId: string, memberId: string, accept: boolean) {
  const a = await tx.vouchAmendment.findUnique({ where: { id: amendmentId } });
  if (!a) throw notFound(MODULE, 'Amendment');
  await lockRow(tx, 'Vouch', a.vouchId);
  const v = await getVouch(tx, a.vouchId);
  if (a.status !== 'PENDING') throw new AppError('INVALID_TRANSITION', `This amendment is already ${a.status.toLowerCase()}.`, MODULE);
  if (a.proposedById === memberId || (v.voucherId !== memberId && v.voucheeId !== memberId)) {
    throw forbidden(MODULE, 'Only the other member on this vouch can respond to the amendment.');
  }
  await tx.vouchAmendment.update({ where: { id: a.id }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', decidedAt: ctx.now } });
  if (!accept) {
    await recordAudit(tx, ctx, {
      module: MODULE,
      action: 'vouch.amendment_declined',
      entityType: 'VOUCH',
      entityId: v.id,
      reason: 'Counterparty declined; terms unchanged.',
      ruleId: RULES.VOUCH_AMEND,
      summary: 'Vouch amendment declined',
    });
    return v;
  }
  if (effectiveEdge(v, ctx.now).status !== 'ACTIVE') throw new AppError('INVALID_TRANSITION', 'The vouch is no longer active.', MODULE);
  const updated = await tx.vouch.update({ where: { id: v.id }, data: { strength: a.toStrength, liabilityPct: a.toLiabilityPct } });
  const liabilityUp = a.toLiabilityPct > a.fromLiabilityPct;
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'vouch.amended',
    entityType: 'VOUCH',
    entityId: v.id,
    before: snapshot(v),
    after: snapshot(updated),
    reason: liabilityUp
      ? `Liability increased with fresh consent from the voucher (${v.voucher.displayName}); max penalty now ${maxPenaltyPoints(a.toLiabilityPct)} points.`
      : 'Both parties consented to the amendment.',
    ruleId: RULES.VOUCH_AMEND,
    summary: `Vouch amended: strength ${a.fromStrength}→${a.toStrength}, liability ${a.fromLiabilityPct}%→${a.toLiabilityPct}%`,
  });
  await refreshCredibility(tx, ctx, [v.voucheeId], 'incoming vouch amended');
  return updated;
}

/**
 * Qualifying interaction: a SETTLED exchange between two members refreshes the decay/expiry
 * timers of any active vouch between them. It never creates or strengthens an edge.
 */
export async function recordQualifyingInteraction(tx: Tx, ctx: Ctx, a: string, b: string, exchangeId: string) {
  const vouches = await tx.vouch.findMany({
    where: { status: 'ACTIVE', OR: [{ voucherId: a, voucheeId: b }, { voucherId: b, voucheeId: a }] },
  });
  for (const v of vouches) {
    if (effectiveEdge(v, ctx.now).status !== 'ACTIVE') continue;
    const updated = await tx.vouch.update({ where: { id: v.id }, data: { lastInteractionAt: ctx.now, expiresAt: refreshedExpiry(ctx.now) } });
    await recordAudit(tx, ctx, {
      module: MODULE,
      action: 'vouch.interaction_refreshed',
      entityType: 'VOUCH',
      entityId: v.id,
      before: snapshot(v),
      after: snapshot(updated),
      reason: `Settled exchange ${exchangeId} is a qualifying interaction; decay/expiry timers reset. Strength unchanged.`,
      ruleId: RULES.VOUCH_INTERACTION,
      summary: 'Vouch timers refreshed by a settled exchange (strength unchanged)',
    });
  }
  return vouches.map((v) => v.voucheeId);
}

/** Persists EXPIRED status for edges past their expiry date (reachability already ignores them). */
export async function expireStaleVouches(tx: Tx, ctx: Ctx) {
  const due = await tx.vouch.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: ctx.now } } });
  for (const v of due) {
    const updated = await tx.vouch.update({ where: { id: v.id }, data: { status: 'EXPIRED', endedAt: v.expiresAt, endReason: 'no qualifying interaction' } });
    await recordAudit(tx, ctx, {
      module: MODULE,
      action: 'vouch.expired',
      entityType: 'VOUCH',
      entityId: v.id,
      before: snapshot(v),
      after: snapshot(updated),
      reason: `No qualifying interaction for ${POLICY.vouches.expireAfterMonths} months.`,
      ruleId: RULES.VOUCH_EXPIRE,
      summary: 'Vouch expired after inactivity',
    });
  }
  await tx.invitation.updateMany({ where: { status: 'OPEN', expiresAt: { lte: ctx.now } }, data: { status: 'EXPIRED' } });
  if (due.length) await refreshCredibility(tx, ctx, due.map((v) => v.voucheeId), 'incoming vouch expired');
  return due.length;
}

/** Active direct vouches for the given members, captured when an exchange is accepted. */
export async function liabilitySnapshot(db: Db, memberIds: string[], now: Date) {
  const rows = await db.vouch.findMany({ where: { voucheeId: { in: memberIds }, status: 'ACTIVE' } });
  return rows
    .filter((v) => effectiveEdge(v, now).status === 'ACTIVE')
    .map((v) => ({ vouchId: v.id, voucherId: v.voucherId, voucheeId: v.voucheeId, strength: v.strength, liabilityPct: v.liabilityPct }));
}

export async function listVouchesFor(db: Db, memberId: string) {
  return db.vouch.findMany({
    where: { OR: [{ voucherId: memberId }, { voucheeId: memberId }] },
    include: { voucher: true, vouchee: true, amendments: { orderBy: { createdAt: 'desc' } } },
    orderBy: { createdAt: 'desc' },
  });
}

export function toAmendmentView(a: {
  id: string;
  vouchId: string;
  proposedById: string;
  fromStrength: number;
  toStrength: number;
  fromLiabilityPct: number;
  toLiabilityPct: number;
  status: string;
  createdAt: Date;
}): VouchAmendmentView {
  return { ...a, increasesLiability: a.toLiabilityPct > a.fromLiabilityPct, createdAt: a.createdAt.toISOString() };
}

/** Used when a member leaves: end all live vouches in both directions (history is kept). */
export async function endAllVouchesForMember(tx: Tx, ctx: Ctx, memberId: string) {
  const live = await tx.vouch.findMany({ where: { status: { in: ['ACTIVE', 'PENDING'] }, OR: [{ voucherId: memberId }, { voucheeId: memberId }] } });
  for (const v of live) await revokeVouch(tx, ctx, v.id, memberId, 'member left the community', RULES.WITHDRAW_LEAVE);
  return live.length;
}

/** Strongest effective active incoming vouch (used for the guarantor rule). */
export async function strongestIncomingVouch(db: Db, memberId: string, now: Date) {
  const rows = await db.vouch.findMany({ where: { voucheeId: memberId, status: 'ACTIVE' }, include: { voucher: true } });
  return rows
    .filter((v) => v.voucher.status === 'ACTIVE')
    .map((v) => ({ v, e: effectiveEdge(v, now) }))
    .filter(({ e }) => e.status === 'ACTIVE')
    .sort((a, b) => b.e.effectiveStrength - a.e.effectiveStrength)[0] ?? null;
}
