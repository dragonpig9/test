import { randomBytes } from 'node:crypto';
import type { Dispute, DisputeOutcome, DisputeStatus, Prisma, VoteChoice } from '@prisma/client';
import type { OpenDisputeInput } from '@commonhours/shared';
import { env } from '../../config/env';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { addDays } from '../../core/dates';
import { lockRow, type Db, type Tx } from '../../core/db';
import { AppError, forbidden, notFound } from '../../core/errors';
import { assertTransition } from '../../core/state-machine';
import { recordAudit } from '../audit/audit.service';
import { applyPenalty, refreshCredibility, scoreOf } from '../credibility/credibility.service';
import { getExchange } from '../exchanges/exchange.repo';
import { isDue, roleOf } from '../exchanges/exchange.rules';
import { markDisputed, releaseAfterAttestation, settleAfterAttestation } from '../exchanges/exchange.service';
import { getMember } from '../members/member.repo';
import { hopsFrom, loadTrust } from '../trust/trust.service';
import { maxPenaltyPoints } from '../vouches/vouch.rules';
import { evaluateEligibility, selectAttestors, type Candidate, type EligibilityRow } from './attestation.eligibility';
import { disputeMachine } from './attestation.state';

const MODULE = 'attestation';

export const INDEPENDENCE_NOTE =
  'Attestors are at least two active hops from both parties, have no direct vouch/invite relation with them, and have declared no conflict. Graph distance alone does not guarantee independence — people can know each other outside the network — so attestors can recuse themselves and anyone can declare a conflict.';

async function setStatus(tx: Tx, ctx: Ctx, d: Dispute, to: DisputeStatus, data: Prisma.DisputeUpdateInput, audit: { action: string; reason: string; ruleId: string; summary: string }) {
  if (d.status !== to) assertTransition(disputeMachine, d.status, to, audit.action.replace('dispute.', '').replace(/_/g, ' '));
  const u = await tx.dispute.update({ where: { id: d.id }, data: { ...data, status: to } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: audit.action,
    entityType: 'DISPUTE',
    entityId: d.id,
    before: { status: d.status, stage: d.stage, outcome: d.outcome },
    after: { status: u.status, stage: u.stage, outcome: u.outcome, reviewReason: u.reviewReason },
    reason: audit.reason,
    ruleId: audit.ruleId,
    summary: audit.summary,
  });
  return u;
}

async function lockedDispute(tx: Tx, id: string) {
  await lockRow(tx, 'Dispute', id);
  const d = await tx.dispute.findUnique({ where: { id } });
  if (!d) throw notFound(MODULE, 'Dispute');
  return d;
}

/**
 * Opening a dispute freezes the existing reservation and starts attestation.
 * It does NOT change anyone's credibility. Settled exchanges cannot be disputed.
 */
export async function openDispute(tx: Tx, ctx: Ctx, memberId: string, input: OpenDisputeInput) {
  const ex = await getExchange(tx, input.exchangeId);
  if (roleOf(ex, memberId) === 'observer') throw forbidden(MODULE, 'Only the provider or recipient can dispute this exchange.');
  if (ex.status === 'SETTLED') {
    throw new AppError('INVALID_TRANSITION', 'This exchange is already settled. Settled credits cannot be frozen without an explicit reversal workflow, which this MVP does not offer.', MODULE);
  }
  if (ex.status !== 'ACCEPTED') throw new AppError('INVALID_TRANSITION', `Only ACCEPTED exchanges can be disputed (this one is ${ex.status}).`, MODULE);
  if (!isDue(ex, ctx.now)) throw new AppError('SERVICE_NOT_YET_DUE', `The service is scheduled for ${ex.scheduledAt.toISOString()}. A dispute can be opened once that time has passed.`, MODULE);
  if (input.condition === 'PUNCTUALITY' && !ex.punctualityRequired) {
    throw new AppError(
      'PUNCTUALITY_NOT_AGREED',
      'Punctuality was not an agreed condition of this exchange, so lateness alone cannot be disputed. Disputes are judged only against the terms agreed before the service.',
      MODULE,
    );
  }
  const d = await tx.dispute.create({
    data: {
      exchangeId: ex.id,
      openedById: memberId,
      condition: input.condition,
      claim: input.claim,
      status: 'AWAITING_ATTESTATION',
      stage: 1,
      createdAt: ctx.now,
      evidence: { create: { authorId: memberId, kind: 'STATEMENT', content: input.claim, createdAt: ctx.now } },
    },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'dispute.opened',
    entityType: 'DISPUTE',
    entityId: d.id,
    after: { condition: d.condition, exchangeId: ex.id },
    reason: `Disputed agreed condition ${input.condition}. Opening a dispute does not change anyone's credibility.`,
    ruleId: RULES.DISPUTE_OPEN,
    summary: `${memberId === ex.providerId ? ex.provider.displayName : ex.recipient.displayName} opened a dispute (${input.condition.toLowerCase()})`,
  });
  await markDisputed(tx, ctx, ex.id, `Dispute ${d.id} opened; credits frozen until a final outcome.`);
  return runSelection(tx, ctx, d, 1);
}

/** Computes eligibility for every member (used for selection and shown in the UI/debug panel). */
export async function computeEligibility(db: Db, disputeId: string, now: Date) {
  const d = await db.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: { exchange: { include: { provider: true, recipient: true } }, assignments: true } });
  const parties = [
    { id: d.exchange.providerId, name: d.exchange.provider.displayName },
    { id: d.exchange.recipientId, name: d.exchange.recipient.displayName },
  ];
  const trust = await loadTrust(db, now);
  const distances = new Map(parties.map((p) => [p.id, hopsFrom(trust, p.id)]));
  const partyIds = parties.map((p) => p.id);
  const [vouches, invites, conflicts] = await Promise.all([
    db.vouch.findMany({ where: { OR: [{ voucherId: { in: partyIds } }, { voucheeId: { in: partyIds } }] } }),
    db.invitation.findMany({ where: { OR: [{ inviterId: { in: partyIds } }, { acceptedById: { in: partyIds } }] } }),
    db.conflictDeclaration.findMany({ where: { OR: [{ memberId: { in: partyIds } }, { otherMemberId: { in: partyIds } }] } }),
  ]);
  const nameOf = new Map(parties.map((p) => [p.id, p.name]));
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...new Set([...(m.get(k) ?? []), v])]);
  const direct = new Map<string, string[]>();
  for (const v of vouches) {
    if (nameOf.has(v.voucherId)) push(direct, v.voucheeId, nameOf.get(v.voucherId)!);
    if (nameOf.has(v.voucheeId)) push(direct, v.voucherId, nameOf.get(v.voucheeId)!);
  }
  for (const i of invites) {
    if (i.acceptedById && nameOf.has(i.inviterId)) push(direct, i.acceptedById, nameOf.get(i.inviterId)!);
    if (i.acceptedById && nameOf.has(i.acceptedById)) push(direct, i.inviterId, nameOf.get(i.acceptedById)!);
  }
  const conf = new Map<string, string[]>();
  for (const c of conflicts) {
    if (nameOf.has(c.otherMemberId)) push(conf, c.memberId, nameOf.get(c.otherMemberId)!);
    if (nameOf.has(c.memberId)) push(conf, c.otherMemberId, nameOf.get(c.memberId)!);
  }
  const candidates: Candidate[] = [];
  for (const m of trust.members) {
    candidates.push({ id: m.id, handle: m.handle, displayName: m.displayName, status: m.status, score: await scoreOf(db, m.id, now) });
  }
  const ctx = { parties, distances, directRelations: direct, conflicts: conf, alreadySelected: new Set(d.assignments.map((a) => a.attestorId)) };
  const rows = candidates.map((c) => evaluateEligibility(c, ctx));
  return { dispute: d, candidates, rows };
}

function selectionSeed(d: { exchange: { scheduledAt: Date; provider: { handle: string }; recipient: { handle: string } } }, round: number) {
  // Demo mode: reproducible seed derived from stable data (not database ids), so a reset replays identically.
  if (env.demoMode) return `${POLICY.attestation.demoSeed}:${d.exchange.provider.handle}-${d.exchange.recipient.handle}:${d.exchange.scheduledAt.toISOString()}:round${round}`;
  return randomBytes(16).toString('hex');
}

/**
 * Runs a selection round. Stage 1 needs one attestor, stage 2 a panel of three.
 * Too few eligible candidates → NEEDS_REVIEW with the blocker and next action; credits stay frozen.
 */
async function runSelection(tx: Tx, ctx: Ctx, d0: Dispute, stage: 1 | 2, replacementFor?: number) {
  const { dispute, candidates, rows } = await computeEligibility(tx, d0.id, ctx.now);
  const round = replacementFor ?? (await tx.attestorSelection.count({ where: { disputeId: d0.id } })) + 1;
  const required = replacementFor ? 1 : stage === 1 ? POLICY.attestation.singleAttestors : POLICY.attestation.panelSize;
  const eligible = candidates.filter((c) => rows.find((r) => r.memberId === c.id)!.eligible);
  const seed = selectionSeed(dispute, replacementFor ? round * 100 + dispute.assignments.length : round);
  const sufficient = eligible.length >= required;
  const selected = sufficient ? selectAttestors(eligible, required, seed) : [];
  const sel = await tx.attestorSelection.create({
    data: {
      disputeId: d0.id,
      round,
      stage,
      seed,
      candidates: JSON.parse(JSON.stringify(rows)),
      selectedIds: selected.map((s) => s.id),
      requiredCount: required,
      sufficient,
      createdAt: ctx.now,
    },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'dispute.attestors_selected',
    entityType: 'DISPUTE',
    entityId: d0.id,
    after: { selectionId: sel.id, round, stage, seed, eligible: eligible.map((e) => e.handle), selected: selected.map((s) => s.handle) },
    reason: `${eligible.length} eligible candidate(s), ${required} required. Seeded random draw (seed recorded).`,
    ruleId: RULES.DISPUTE_SELECT,
    summary: sufficient
      ? `Selected ${selected.map((s) => s.displayName).join(', ')} as ${stage === 1 ? 'attestor' : 'panel'} (round ${round})`
      : `Not enough eligible attestors: ${eligible.length} of ${required} needed`,
  });
  const fresh = await tx.dispute.findUniqueOrThrow({ where: { id: d0.id } });
  if (!sufficient) {
    return setStatus(tx, ctx, fresh, 'NEEDS_REVIEW', {
      stage,
      reviewReason: `INSUFFICIENT_ATTESTORS: only ${eligible.length} eligible member(s) for ${required} required ${stage === 1 ? 'attestor' : 'panel seat(s)'}. See the eligibility table for each exclusion reason.`,
      nextAction:
        'Credits stay frozen. Next: (a) retry selection when more members become eligible (new members, expired relations, raised credibility), or (b) both parties agree a mutual resolution. The system will not choose a winner.',
      voteDeadline: null,
    }, {
      action: 'dispute.needs_review',
      reason: 'Insufficient eligible attestors; never silently choosing a winner.',
      ruleId: RULES.DISPUTE_REVIEW,
      summary: 'Dispute needs review: insufficient eligible attestors',
    });
  }
  for (const s of selected) {
    await tx.attestorAssignment.create({ data: { disputeId: d0.id, round, stage, attestorId: s.id, createdAt: ctx.now } });
  }
  const target: DisputeStatus = stage === 1 ? 'AWAITING_ATTESTATION' : 'PANEL_REVIEW';
  return setStatus(tx, ctx, fresh, target, { stage, reviewReason: null, nextAction: null, voteDeadline: addDays(ctx.now, POLICY.attestation.voteWindowDays) }, {
    action: stage === 1 ? 'dispute.awaiting_attestation' : 'dispute.panel_review',
    reason: stage === 1 ? 'One attestor will check whether the agreed activity happened.' : 'Escalated to a panel of three; a majority of two decides.',
    ruleId: RULES.DISPUTE_SELECT,
    summary: stage === 1 ? 'Awaiting attestor vote' : 'Panel of three selected',
  });
}

export async function addEvidence(tx: Tx, ctx: Ctx, disputeId: string, memberId: string, kind: string, content: string) {
  const d = await lockedDispute(tx, disputeId);
  const ex = await getExchange(tx, d.exchangeId);
  if (roleOf(ex, memberId) === 'observer') throw forbidden(MODULE, 'Only the two parties can add evidence.');
  if (d.status === 'RESOLVED') throw new AppError('DISPUTE_NOT_OPEN', 'This dispute is resolved; evidence is closed.', MODULE);
  const e = await tx.evidence.create({ data: { disputeId, authorId: memberId, kind, content, createdAt: ctx.now } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'dispute.evidence_added',
    entityType: 'DISPUTE',
    entityId: disputeId,
    after: { evidenceId: e.id, kind },
    reason: 'Party statement/evidence recorded.',
    ruleId: RULES.DISPUTE_OPEN,
    summary: `Evidence added (${kind.toLowerCase()})`,
  });
  return e;
}

/**
 * Attestor votes on ONE question: did the pre-agreed activity happen as agreed?
 * Votes need a reason. Nobody is penalised for disagreeing with the majority.
 */
export async function castVote(tx: Tx, ctx: Ctx, disputeId: string, memberId: string, vote: VoteChoice, reason: string) {
  const d = await lockedDispute(tx, disputeId);
  if (d.status !== 'AWAITING_ATTESTATION' && d.status !== 'PANEL_REVIEW') {
    throw new AppError('DISPUTE_NOT_OPEN', `Votes are not being collected (dispute is ${d.status}).`, MODULE);
  }
  const a = await tx.attestorAssignment.findUnique({ where: { disputeId_attestorId: { disputeId, attestorId: memberId } } });
  if (!a || a.stage !== d.stage) throw new AppError('NOT_ASSIGNED', 'You are not a selected attestor for the current round of this dispute.', MODULE);
  if (a.status === 'VOTED') throw new AppError('ALREADY_DONE', 'You already voted; votes cannot be changed.', MODULE, undefined, 409);
  if (a.status !== 'ASSIGNED') throw new AppError('NOT_ASSIGNED', `Your assignment is ${a.status.toLowerCase()}.`, MODULE);
  if (d.voteDeadline && ctx.now > d.voteDeadline) throw new AppError('DISPUTE_NOT_OPEN', 'The voting deadline has passed.', MODULE);
  await tx.attestorAssignment.update({ where: { id: a.id }, data: { status: 'VOTED', vote, reason, votedAt: ctx.now } });
  const attestor = await getMember(tx, memberId);
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'dispute.vote_cast',
    entityType: 'DISPUTE',
    entityId: disputeId,
    after: { attestor: attestor.handle, vote, round: a.round, stage: a.stage },
    reason,
    ruleId: RULES.DISPUTE_VOTE,
    summary: `${attestor.displayName} voted ${vote.toLowerCase()}`,
  });
  await refreshCredibility(tx, ctx, [memberId], 'attestation vote cast');

  if (d.stage === 1) {
    if (vote === 'UNCLEAR') return runSelection(tx, ctx, await tx.dispute.update({ where: { id: d.id }, data: { stage: 2 } }), 2);
    return resolve(tx, ctx, d, vote, 'single attestor');
  }
  const votes = await tx.attestorAssignment.findMany({ where: { disputeId, stage: 2, round: a.round, status: { in: ['VOTED', 'ASSIGNED'] } } });
  const voted = votes.filter((v) => v.status === 'VOTED');
  const count = (c: VoteChoice) => voted.filter((v) => v.vote === c).length;
  if (count('CONFIRMED') >= POLICY.attestation.panelMajority) return resolve(tx, ctx, d, 'CONFIRMED', 'panel majority');
  if (count('REFUTED') >= POLICY.attestation.panelMajority) return resolve(tx, ctx, d, 'REFUTED', 'panel majority');
  if (votes.every((v) => v.status === 'VOTED')) {
    return setStatus(tx, ctx, d, 'NEEDS_REVIEW', {
      reviewReason: `PANEL_UNRESOLVED: votes were ${voted.map((v) => v.vote).join(', ')} — no ${POLICY.attestation.panelMajority}-vote majority.`,
      nextAction: 'Credits stay frozen. Next: retry with a fresh panel, or both parties agree a mutual resolution. The system will not choose a winner.',
      voteDeadline: null,
    }, {
      action: 'dispute.needs_review',
      reason: 'Panel did not reach a majority.',
      ruleId: RULES.DISPUTE_REVIEW,
      summary: 'Dispute needs review: panel unresolved',
    });
  }
  return tx.dispute.findUniqueOrThrow({ where: { id: d.id } });
}

/** Final outcome. Penalties only for a final REFUTED finding made by attestors (never on opening). */
async function resolve(tx: Tx, ctx: Ctx, d: Dispute, outcome: DisputeOutcome, source: string) {
  const ex = await getExchange(tx, d.exchangeId);
  const u = await setStatus(tx, ctx, d, 'RESOLVED', { outcome, outcomeSource: source, resolvedAt: ctx.now, nextAction: null, reviewReason: null, voteDeadline: null }, {
    action: 'dispute.resolved',
    reason: outcome === 'CONFIRMED' ? 'The agreed activity occurred; settle credits.' : 'The agreed activity did not occur; release the reservation.',
    ruleId: source === 'mutual agreement' ? RULES.DISPUTE_MUTUAL : RULES.DISPUTE_RESOLVE,
    summary: `Dispute resolved: ${outcome.toLowerCase()} (${source})`,
  });
  await tx.attestorAssignment.updateMany({ where: { disputeId: d.id, status: 'ASSIGNED' }, data: { status: 'NOT_NEEDED' } });
  const touched = [ex.providerId, ex.recipientId];
  if (outcome === 'CONFIRMED') {
    await settleAfterAttestation(tx, ctx, ex.id, source);
  } else {
    await releaseAfterAttestation(tx, ctx, ex.id, source);
    if (source !== 'mutual agreement') {
      await applyPenalty(tx, ctx, {
        memberId: ex.providerId,
        kind: 'NONPERFORMANCE_FINDING',
        points: POLICY.penalties.nonperformanceFinding,
        disputeId: d.id,
        finding: `Final finding (${source}) that the agreed activity "${ex.deliverable}" did not occur as agreed.`,
        ruleId: RULES.PENALTY_NONPERFORMANCE,
      });
      // Liability: only DIRECT vouchers of the provider, per the snapshot taken at acceptance. No cascade.
      const snap = (ex.liabilitySnapshot as { vouchId: string; voucherId: string; voucheeId: string; liabilityPct: number }[] | null) ?? [];
      for (const s of snap.filter((x) => x.voucheeId === ex.providerId)) {
        await applyPenalty(tx, ctx, {
          memberId: s.voucherId,
          kind: 'VOUCH_LIABILITY',
          points: maxPenaltyPoints(s.liabilityPct),
          disputeId: d.id,
          vouchId: s.vouchId,
          finding: `Vouch liability (${s.liabilityPct}% × ${POLICY.vouches.maxLiabilityPoints}) for a final nonperformance finding against ${ex.provider.displayName}, under the vouch active when the exchange was accepted.`,
          ruleId: RULES.PENALTY_LIABILITY,
        });
        touched.push(s.voucherId);
      }
    }
  }
  await refreshCredibility(tx, ctx, touched, `dispute resolved: ${outcome.toLowerCase()}`);
  return u;
}

export async function recuse(tx: Tx, ctx: Ctx, disputeId: string, memberId: string, reason: string) {
  const d = await lockedDispute(tx, disputeId);
  const a = await tx.attestorAssignment.findUnique({ where: { disputeId_attestorId: { disputeId, attestorId: memberId } } });
  if (!a || a.status !== 'ASSIGNED') throw new AppError('NOT_ASSIGNED', 'You have no open assignment on this dispute.', MODULE);
  await tx.attestorAssignment.update({ where: { id: a.id }, data: { status: 'RECUSED', reason } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'dispute.attestor_recused',
    entityType: 'DISPUTE',
    entityId: disputeId,
    after: { attestorId: memberId },
    reason,
    ruleId: RULES.CONFLICT,
    summary: 'An attestor recused (conflict of interest); selecting a replacement',
  });
  return runSelection(tx, ctx, d, d.stage as 1 | 2, a.round);
}

export async function retrySelection(tx: Tx, ctx: Ctx, disputeId: string, memberId: string) {
  const d = await lockedDispute(tx, disputeId);
  const ex = await getExchange(tx, d.exchangeId);
  if (roleOf(ex, memberId) === 'observer') throw forbidden(MODULE, 'Only the parties can request a new selection.');
  if (d.status !== 'NEEDS_REVIEW') throw new AppError('INVALID_TRANSITION', `Selection can only be retried from NEEDS_REVIEW (dispute is ${d.status}).`, MODULE);
  await tx.attestorAssignment.updateMany({ where: { disputeId, status: 'ASSIGNED' }, data: { status: 'NOT_NEEDED' } });
  return runSelection(tx, ctx, d, d.stage as 1 | 2);
}

/** Both parties can always settle a dispute between themselves. Mutual outcomes carry no penalty finding. */
export async function proposeMutual(tx: Tx, ctx: Ctx, disputeId: string, memberId: string, outcome: DisputeOutcome) {
  const d = await lockedDispute(tx, disputeId);
  const ex = await getExchange(tx, d.exchangeId);
  if (roleOf(ex, memberId) === 'observer') throw forbidden(MODULE, 'Only the parties can propose a mutual resolution.');
  if (d.status === 'RESOLVED') throw new AppError('DISPUTE_NOT_OPEN', 'This dispute is already resolved.', MODULE);
  if (d.mutualProposalById && d.mutualProposalById !== memberId && d.mutualProposalOutcome === outcome) {
    return resolve(tx, ctx, d, outcome, 'mutual agreement');
  }
  const u = await tx.dispute.update({ where: { id: d.id }, data: { mutualProposalById: memberId, mutualProposalOutcome: outcome } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'dispute.mutual_proposed',
    entityType: 'DISPUTE',
    entityId: d.id,
    after: { outcome },
    reason: 'A party proposed resolving by agreement; the other party must propose the same outcome.',
    ruleId: RULES.DISPUTE_MUTUAL,
    summary: `Mutual resolution proposed: ${outcome.toLowerCase()}`,
  });
  return u;
}

/** Deadline sweep: unvoted assignments become MISSED and the dispute moves to NEEDS_REVIEW (no quorum). */
export async function sweepVoteDeadlines(tx: Tx, ctx: Ctx) {
  const due = await tx.dispute.findMany({ where: { status: { in: ['AWAITING_ATTESTATION', 'PANEL_REVIEW'] }, voteDeadline: { lte: ctx.now } } });
  for (const d of due) {
    const missed = await tx.attestorAssignment.findMany({ where: { disputeId: d.id, status: 'ASSIGNED' } });
    await tx.attestorAssignment.updateMany({ where: { disputeId: d.id, status: 'ASSIGNED' }, data: { status: 'MISSED' } });
    await setStatus(tx, ctx, d, 'NEEDS_REVIEW', {
      reviewReason: `NO_QUORUM: ${missed.length} attestor(s) did not vote before the deadline ${d.voteDeadline?.toISOString()}.`,
      nextAction: 'Credits stay frozen. Next: retry selection, or both parties agree a mutual resolution.',
      voteDeadline: null,
    }, {
      action: 'dispute.needs_review',
      reason: 'Voting deadline passed without a decision.',
      ruleId: RULES.DISPUTE_REVIEW,
      summary: 'Dispute needs review: no quorum before deadline',
    });
    if (missed.length) await refreshCredibility(tx, ctx, missed.map((m) => m.attestorId), 'attestation vote missed');
  }
  return due.length;
}

export async function declareConflict(tx: Tx, ctx: Ctx, memberId: string, otherMemberId: string, reason: string) {
  if (memberId === otherMemberId) throw new AppError('VALIDATION_FAILED', 'You cannot declare a conflict with yourself.', MODULE);
  const other = await getMember(tx, otherMemberId);
  const existing = await tx.conflictDeclaration.findUnique({ where: { memberId_otherMemberId: { memberId, otherMemberId } } });
  if (existing) throw new AppError('ALREADY_DONE', 'You already declared this conflict.', MODULE, undefined, 409);
  const c = await tx.conflictDeclaration.create({ data: { memberId, otherMemberId, reason, createdAt: ctx.now } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'conflict.declared',
    entityType: 'MEMBER',
    entityId: memberId,
    after: { otherMemberId, reason },
    reason: 'Declared conflicts exclude a member from attesting disputes involving the other member.',
    ruleId: RULES.CONFLICT,
    summary: `Declared a conflict of interest with ${other.displayName}`,
  });
  return c;
}

export type { EligibilityRow };
