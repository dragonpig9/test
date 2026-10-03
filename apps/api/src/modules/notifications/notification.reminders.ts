import type { Ctx } from '../../core/context';
import { addHours } from '../../core/dates';
import type { Tx } from '../../core/db';
import { notify, type NotificationIntent } from './notification.events';

const fmt = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * Time-based reminders (read-only over exchanges/disputes; writes only notifications, after commit).
 * Runs with the other sweeps (clock advance, POST /api/demo/sweeps, and the server's periodic timer).
 * Dedupe keys make repeated sweeps harmless.
 */
export async function sweepReminders(tx: Tx, ctx: Ctx) {
  const soon = addHours(ctx.now, 24);
  const intents: NotificationIntent[] = [];
  const upcoming = await tx.exchange.findMany({
    where: { status: 'ACCEPTED', scheduledAt: { gt: ctx.now, lte: soon } },
    include: { provider: true, recipient: true },
  });
  for (const ex of upcoming) {
    for (const [me, other] of [
      [ex.provider, ex.recipient],
      [ex.recipient, ex.provider],
    ]) {
      intents.push({
        memberId: me.id,
        kind: 'service.upcoming',
        category: 'reminders',
        title: `Upcoming: “${ex.deliverable}” with ${other.displayName}`,
        body: `Scheduled for ${fmt(ex.scheduledAt)}. Cancellation is free until ${ex.cancellationNoticeHours}h before.`,
        link: `/exchanges/${ex.id}`,
        entityType: 'EXCHANGE',
        entityId: ex.id,
        dedupeKey: `service.upcoming:${ex.id}:${me.id}`,
        at: ctx.now,
      });
    }
  }
  const due = await tx.exchange.findMany({
    where: { status: 'ACCEPTED', scheduledAt: { lte: ctx.now }, confirmationDeadline: { gt: ctx.now } },
    include: { provider: true, recipient: true },
  });
  for (const ex of due) {
    for (const [me, confirmed] of [
      [ex.provider, ex.providerConfirmedAt],
      [ex.recipient, ex.recipientConfirmedAt],
    ] as const) {
      if (confirmed) continue;
      intents.push({
        memberId: me.id,
        kind: 'confirmation.requested',
        category: 'reminders',
        title: `Please confirm “${ex.deliverable}”`,
        body: `The service was scheduled for ${fmt(ex.scheduledAt)}. Confirm completion by ${fmt(ex.confirmationDeadline)}, or open a dispute if the agreed activity did not happen.`,
        link: `/exchanges/${ex.id}`,
        entityType: 'EXCHANGE',
        entityId: ex.id,
        dedupeKey: `confirmation.due:${ex.id}:${me.id}`,
        at: ctx.now,
      });
    }
  }
  const voting = await tx.attestorAssignment.findMany({
    where: { status: 'ASSIGNED', dispute: { status: { in: ['AWAITING_ATTESTATION', 'PANEL_REVIEW'] }, voteDeadline: { gt: ctx.now, lte: soon } } },
    include: { dispute: true },
  });
  for (const a of voting) {
    intents.push({
      memberId: a.attestorId,
      kind: 'jury.deadline',
      category: 'jury',
      title: 'Your jury vote is due within 24 hours',
      body: `Voting closes ${fmt(a.dispute.voteDeadline!)}.`,
      link: `/disputes/${a.disputeId}`,
      entityType: 'DISPUTE',
      entityId: a.disputeId,
      dedupeKey: `jury.deadline:${a.disputeId}:${a.attestorId}:${a.round}`,
      at: ctx.now,
    });
  }
  notify(intents);
  return intents.length;
}
