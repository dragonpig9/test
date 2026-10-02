import { Router } from 'express';
import { conflictSchema, evidenceSchema, mutualResolutionSchema, openDisputeSchema, recuseSchema, voteSchema } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { toSummary } from '../members/member.repo';
import { disputeView, listDisputesFor } from './attestation.repo';
import { addEvidence, castVote, declareConflict, openDispute, proposeMutual, recuse, retrySelection } from './attestation.service';

export const disputesRouter = Router();
export const conflictsRouter = Router();
const M = 'attestation';

disputesRouter.get(
  '/',
  ah(async (req, res) => {
    const scope = req.query.scope === 'all' ? 'all' : 'mine';
    res.json({ disputes: await listDisputesFor(prisma, actorId(req, M), scope) });
  }),
);

disputesRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json({ dispute: await disputeView(prisma, req.params.id, actorId(req, M), req.ctx.now) });
  }),
);

disputesRouter.post(
  '/',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const input = parseBody(openDisputeSchema, req.body, M);
    const d = await withTx((tx) => openDispute(tx, req.ctx, me, input));
    res.status(201).json({ dispute: await disputeView(prisma, d.id, me, req.ctx.now) });
  }),
);

disputesRouter.post(
  '/:id/evidence',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { kind, content } = parseBody(evidenceSchema, req.body, M);
    await withTx((tx) => addEvidence(tx, req.ctx, req.params.id, me, kind, content));
    res.status(201).json({ dispute: await disputeView(prisma, req.params.id, me, req.ctx.now) });
  }),
);

disputesRouter.post(
  '/:id/votes',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { vote, reason } = parseBody(voteSchema, req.body, M);
    await withTx((tx) => castVote(tx, req.ctx, req.params.id, me, vote, reason));
    res.json({ dispute: await disputeView(prisma, req.params.id, me, req.ctx.now) });
  }),
);

disputesRouter.post(
  '/:id/recuse',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { reason } = parseBody(recuseSchema, req.body, M);
    await withTx((tx) => recuse(tx, req.ctx, req.params.id, me, reason));
    res.json({ dispute: await disputeView(prisma, req.params.id, me, req.ctx.now) });
  }),
);

disputesRouter.post(
  '/:id/retry-selection',
  ah(async (req, res) => {
    const me = actorId(req, M);
    await withTx((tx) => retrySelection(tx, req.ctx, req.params.id, me));
    res.json({ dispute: await disputeView(prisma, req.params.id, me, req.ctx.now) });
  }),
);

disputesRouter.post(
  '/:id/mutual',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { outcome } = parseBody(mutualResolutionSchema, req.body, M);
    await withTx((tx) => proposeMutual(tx, req.ctx, req.params.id, me, outcome));
    res.json({ dispute: await disputeView(prisma, req.params.id, me, req.ctx.now) });
  }),
);

conflictsRouter.get(
  '/',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const rows = await prisma.conflictDeclaration.findMany({
      where: { OR: [{ memberId: me }, { otherMemberId: me }] },
      include: { member: true, otherMember: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      conflicts: rows.map((c) => ({ id: c.id, member: toSummary(c.member), other: toSummary(c.otherMember), reason: c.reason, createdAt: c.createdAt.toISOString() })),
    });
  }),
);

conflictsRouter.post(
  '/',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { otherMemberId, reason } = parseBody(conflictSchema, req.body, M);
    await withTx((tx) => declareConflict(tx, req.ctx, me, otherMemberId, reason));
    res.status(201).json({ ok: true });
  }),
);
