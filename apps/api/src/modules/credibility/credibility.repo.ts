import type { Db } from '../../core/db';
import { POLICY } from '../../config/policy';
import { effectiveEdge } from '../vouches/vouch.rules';
import type { CredibilityInputs } from './credibility.rules';

/** Gathers every input of the credibility formula from persisted records. */
export async function gatherInputs(db: Db, memberId: string, now: Date): Promise<CredibilityInputs> {
  const member = await db.member.findUniqueOrThrow({ where: { id: memberId } });
  const [completedServices, settledAsParty, incoming, penalties, votesCast, votesMissed] = await Promise.all([
    db.exchange.count({ where: { providerId: memberId, status: 'SETTLED' } }),
    db.exchange.findMany({
      where: { status: 'SETTLED', dispute: null, OR: [{ providerId: memberId }, { recipientId: memberId }] },
      select: { providerId: true, providerConfirmedAt: true, recipientConfirmedAt: true, confirmationDeadline: true },
    }),
    db.vouch.findMany({ where: { voucheeId: memberId, status: 'ACTIVE' }, include: { voucher: true } }),
    db.credibilityPenalty.aggregate({ where: { memberId }, _sum: { points: true } }),
    db.attestorAssignment.count({ where: { attestorId: memberId, status: 'VOTED' } }),
    db.attestorAssignment.count({ where: { attestorId: memberId, status: 'MISSED' } }),
  ]);
  const timely = settledAsParty.filter((x) => {
    const mine = x.providerId === memberId ? x.providerConfirmedAt : x.recipientConfirmedAt;
    return mine !== null && mine.getTime() <= x.confirmationDeadline.getTime();
  }).length;
  // Vouches from members who have left no longer count as active endorsement.
  const active = incoming
    .filter((v) => v.voucher.status === 'ACTIVE')
    .map((v) => effectiveEdge(v, now))
    .filter((e) => e.status === 'ACTIVE');
  return {
    completedServices,
    finalizedNonDisputed: settledAsParty.length,
    timelyConfirmations: timely,
    incomingStrengthSum: active.reduce((s, e) => s + e.effectiveStrength, 0),
    incomingVouchCount: active.length,
    bootstrapAllowance: member.isBootstrap ? POLICY.bootstrap.bootstrapVouchAllowance : 0,
    penaltyPoints: penalties._sum.points ?? 0,
    votesCast,
    votesMissed,
  };
}
