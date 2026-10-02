import { Router } from 'express';
import { amendVouchSchema, proposeVouchSchema, revokeSchema } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { toSummary } from '../members/member.repo';
import { maxPenaltyPoints, vouchTermsText } from './vouch.rules';
import {
  listVouchesFor,
  outgoingCommitmentCount,
  proposeAmendment,
  proposeVouch,
  respondToAmendment,
  respondToVouch,
  revokeVouch,
  toAmendmentView,
} from './vouch.service';
import { toEdgeView } from './vouch.view';

export const vouchesRouter = Router();
const M = 'vouches';

vouchesRouter.get(
  '/',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const rows = await listVouchesFor(prisma, me);
    const used = await outgoingCommitmentCount(prisma, me, req.ctx.now);
    res.json({
      limit: POLICY.vouches.maxActiveOutgoing,
      used,
      vouches: rows.map((v) => ({
        ...toEdgeView(v, req.ctx.now),
        voucher: toSummary(v.voucher),
        vouchee: toSummary(v.vouchee),
        direction: v.voucherId === me ? 'outgoing' : 'incoming',
        origin: v.origin,
        endReason: v.endReason,
        terms: vouchTermsText(v.strength, v.liabilityPct),
        amendments: v.amendments.map(toAmendmentView),
      })),
    });
  }),
);

vouchesRouter.get(
  '/terms',
  ah(async (req, res) => {
    const strength = Number(req.query.strength ?? 0.7);
    const liabilityPct = Number(req.query.liabilityPct ?? 10);
    res.json({ terms: vouchTermsText(strength, liabilityPct), maxPenaltyPoints: maxPenaltyPoints(liabilityPct) });
  }),
);

vouchesRouter.post(
  '/',
  ah(async (req, res) => {
    const input = parseBody(proposeVouchSchema, req.body, M);
    const v = await withTx((tx) => proposeVouch(tx, req.ctx, actorId(req, M), input));
    res.status(201).json({ vouch: toEdgeView(v, req.ctx.now) });
  }),
);

vouchesRouter.post(
  '/:id/accept',
  ah(async (req, res) => {
    const v = await withTx((tx) => respondToVouch(tx, req.ctx, req.params.id, actorId(req, M), true));
    res.json({ vouch: toEdgeView(v, req.ctx.now) });
  }),
);

vouchesRouter.post(
  '/:id/decline',
  ah(async (req, res) => {
    const v = await withTx((tx) => respondToVouch(tx, req.ctx, req.params.id, actorId(req, M), false));
    res.json({ vouch: toEdgeView(v, req.ctx.now) });
  }),
);

vouchesRouter.post(
  '/:id/revoke',
  ah(async (req, res) => {
    const { reason } = parseBody(revokeSchema, req.body, M);
    const v = await withTx((tx) => revokeVouch(tx, req.ctx, req.params.id, actorId(req, M), reason));
    res.json({ vouch: toEdgeView(v, req.ctx.now) });
  }),
);

vouchesRouter.post(
  '/:id/amendments',
  ah(async (req, res) => {
    const input = parseBody(amendVouchSchema, req.body, M);
    const a = await withTx((tx) => proposeAmendment(tx, req.ctx, req.params.id, actorId(req, M), input));
    res.status(201).json({ amendment: toAmendmentView(a) });
  }),
);

vouchesRouter.post(
  '/amendments/:id/:decision(accept|decline)',
  ah(async (req, res) => {
    const v = await withTx((tx) => respondToAmendment(tx, req.ctx, req.params.id, actorId(req, M), req.params.decision === 'accept'));
    res.json({ vouch: toEdgeView(v, req.ctx.now) });
  }),
);
