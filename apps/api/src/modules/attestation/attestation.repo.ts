import type { DisputeView, EligibilityRow as EligibilityRowView } from '@commonhours/shared';
import { formatCredits } from '@commonhours/shared';
import type { Db } from '../../core/db';
import { notFound } from '../../core/errors';
import { timelineFor } from '../audit/audit.repo';
import { getExchange, toExchangeView } from '../exchanges/exchange.repo';
import { toSummary } from '../members/member.repo';
import { SELECTED_REASON, type EligibilityRow } from './attestation.eligibility';
import { INDEPENDENCE_NOTE } from './attestation.service';

export async function disputeView(db: Db, id: string, viewerId: string, now: Date): Promise<DisputeView> {
  const d = await db.dispute.findUnique({
    where: { id },
    include: {
      openedBy: true,
      evidence: { include: { author: true }, orderBy: { createdAt: 'asc' } },
      selections: { orderBy: [{ createdAt: 'asc' }, { round: 'asc' }] },
      assignments: { include: { attestor: true }, orderBy: [{ round: 'asc' }, { createdAt: 'asc' }] },
      penalties: { include: { member: true } },
    },
  });
  if (!d) throw notFound('attestation', 'Dispute');
  const ex = await getExchange(db, d.exchangeId);
  const members = new Map((await db.member.findMany()).map((m) => [m.id, m]));
  const reasonFor = (round: number, attestorId: string) => {
    const sel = d.selections.filter((s) => s.round === round && s.selectedIds.includes(attestorId)).pop();
    const row = sel ? (sel.candidates as unknown as EligibilityRow[]).find((c) => c.memberId === attestorId) : undefined;
    return row?.selectionReason ?? (sel ? SELECTED_REASON : null);
  };
  const assignments = d.assignments.map((a) => ({
    id: a.id,
    round: a.round,
    attestor: toSummary(a.attestor),
    selectionReason: reasonFor(a.round, a.attestorId),
    status: a.status,
    vote: a.vote,
    reason: a.reason,
    votedAt: a.votedAt?.toISOString() ?? null,
  }));
  const r = ex.reservation;
  const effects: DisputeView['effects'] = [];
  if (r) {
    const total = formatCredits(r.amount + r.giftBonus);
    effects.push({
      kind: 'credits',
      description:
        r.status === 'FROZEN'
          ? `${total} credit(s) frozen: still reserved from ${ex.recipient.displayName}, not paid to ${ex.provider.displayName}.`
          : r.status === 'SETTLED'
            ? `${formatCredits(ex.settledAmount ?? 0)} credit(s) paid from ${ex.recipient.displayName} to ${ex.provider.displayName}.`
            : r.status === 'RELEASED'
              ? `Reservation of ${total} released to ${ex.recipient.displayName}; no payment.`
              : `${total} credit(s) reserved.`,
    });
  }
  if (!d.penalties.length) {
    effects.push({
      kind: 'credibility',
      description: d.status === 'RESOLVED' ? 'No credibility penalties from this dispute.' : 'Opening a dispute changes nobody’s credibility. Only a final finding can.',
    });
  }
  for (const p of d.penalties) effects.push({ kind: 'credibility', description: `${p.member.displayName}: −${p.points} (${p.kind.toLowerCase().replace(/_/g, ' ')}). ${p.finding}` });
  const ledgerTx = await db.ledgerTransaction.findMany({ where: { exchangeId: ex.id }, select: { id: true } });
  const mine = assignments.filter((a) => a.attestor.id === viewerId);
  return {
    id: d.id,
    exchangeId: d.exchangeId,
    exchange: toExchangeView(ex, viewerId, now),
    openedBy: toSummary(d.openedBy),
    condition: d.condition,
    claim: d.claim,
    status: d.status,
    stage: d.stage,
    outcome: d.outcome,
    outcomeSource: d.outcomeSource,
    reviewReason: d.reviewReason,
    nextAction: d.nextAction,
    voteDeadline: d.voteDeadline?.toISOString() ?? null,
    mutualProposal: d.mutualProposalById && d.mutualProposalOutcome ? { byId: d.mutualProposalById, outcome: d.mutualProposalOutcome } : null,
    createdAt: d.createdAt.toISOString(),
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
    evidence: d.evidence.map((e) => ({ id: e.id, author: toSummary(e.author), kind: e.kind, content: e.content, createdAt: e.createdAt.toISOString() })),
    selections: d.selections.map((s) => ({
      id: s.id,
      round: s.round,
      seed: s.seed,
      method: s.method,
      requiredCount: s.requiredCount,
      sufficient: s.sufficient,
      selected: s.selectedIds.map((sid) => toSummary(members.get(sid)!)),
      candidates: (s.candidates as unknown as EligibilityRow[]).map(
        (c): EligibilityRowView => ({
          member: toSummary(members.get(c.memberId)!),
          eligible: c.eligible,
          reasons: c.reasons,
          distanceToParties: c.distances,
          score: c.score,
          closeness: c.closeness ?? null,
          rank: c.rank ?? null,
          selectionReason: c.selectionReason ?? null,
        }),
      ),
      createdAt: s.createdAt.toISOString(),
    })),
    assignments,
    myAssignment: mine.find((a) => a.status === 'ASSIGNED') ?? mine[mine.length - 1] ?? null,
    effects,
    independenceNote: INDEPENDENCE_NOTE,
    timeline: await timelineFor(db, [d.id, ex.id, ...(r ? [r.id] : []), ...ledgerTx.map((t) => t.id)]),
  };
}

export async function listDisputesFor(db: Db, memberId: string, scope: 'mine' | 'all') {
  const rows = await db.dispute.findMany({
    where:
      scope === 'all'
        ? {}
        : { OR: [{ exchange: { providerId: memberId } }, { exchange: { recipientId: memberId } }, { assignments: { some: { attestorId: memberId } } }] },
    include: { exchange: { include: { provider: true, recipient: true } }, assignments: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((d) => ({
    id: d.id,
    exchangeId: d.exchangeId,
    deliverable: d.exchange.deliverable,
    provider: toSummary(d.exchange.provider),
    recipient: toSummary(d.exchange.recipient),
    condition: d.condition,
    status: d.status,
    stage: d.stage,
    outcome: d.outcome,
    createdAt: d.createdAt.toISOString(),
    myRole:
      d.exchange.providerId === memberId || d.exchange.recipientId === memberId
        ? 'party'
        : d.assignments.some((a) => a.attestorId === memberId)
          ? 'attestor'
          : 'observer',
    awaitingMyVote: d.assignments.some((a) => a.attestorId === memberId && a.status === 'ASSIGNED'),
  }));
}
