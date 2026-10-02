import { Router } from 'express';
import { acceptExchangeSchema, cancelExchangeSchema, exchangeTermsSchema, partialSchema, proposeExchangeSchema } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { timelineFor } from '../audit/audit.repo';
import { findPath, loadTrust } from '../trust/trust.service';
import { getExchange, listExchangesFor, toExchangeView } from './exchange.repo';
import {
  acceptExchange,
  acceptPartial,
  cancelExchange,
  confirmCompletion,
  declineOrWithdraw,
  proposeExchange,
  proposePartial,
  updateTerms,
} from './exchange.service';

export const exchangesRouter = Router();
const M = 'exchanges';

async function view(id: string, me: string, now: Date) {
  return toExchangeView(await getExchange(prisma, id), me, now);
}

exchangesRouter.get(
  '/',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const rows = await listExchangesFor(prisma, me);
    res.json({ exchanges: rows.map((r) => toExchangeView(r, me, req.ctx.now)) });
  }),
);

exchangesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const ex = await getExchange(prisma, req.params.id);
    const v = toExchangeView(ex, me, req.ctx.now);
    const trustPath = findPath(await loadTrust(prisma, req.ctx.now), ex.recipientId, ex.providerId);
    const ids = [ex.id, ...(ex.reservation ? [ex.reservation.id] : []), ...(ex.dispute ? [ex.dispute.id] : [])];
    const ledgerTx = await prisma.ledgerTransaction.findMany({ where: { exchangeId: ex.id }, select: { id: true } });
    const timeline = await timelineFor(prisma, [...ids, ...ledgerTx.map((t) => t.id)]);
    res.json({ exchange: v, trustPath, timeline, liabilitySnapshot: ex.liabilitySnapshot });
  }),
);

exchangesRouter.post(
  '/',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const input = parseBody(proposeExchangeSchema, req.body, M);
    const ex = await withTx((tx) => proposeExchange(tx, req.ctx, me, input));
    res.status(201).json({ exchange: await view(ex.id, me, req.ctx.now) });
  }),
);

exchangesRouter.put(
  '/:id/terms',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const input = parseBody(exchangeTermsSchema, req.body, M);
    await withTx((tx) => updateTerms(tx, req.ctx, req.params.id, me, input));
    res.json({ exchange: await view(req.params.id, me, req.ctx.now) });
  }),
);

exchangesRouter.post(
  '/:id/accept',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { termsVersion } = parseBody(acceptExchangeSchema, req.body, M);
    await withTx((tx) => acceptExchange(tx, req.ctx, req.params.id, me, termsVersion));
    res.json({ exchange: await view(req.params.id, me, req.ctx.now) });
  }),
);

exchangesRouter.post(
  '/:id/decline',
  ah(async (req, res) => {
    const me = actorId(req, M);
    await withTx((tx) => declineOrWithdraw(tx, req.ctx, req.params.id, me));
    res.json({ exchange: await view(req.params.id, me, req.ctx.now) });
  }),
);

exchangesRouter.post(
  '/:id/confirm',
  ah(async (req, res) => {
    const me = actorId(req, M);
    await withTx((tx) => confirmCompletion(tx, req.ctx, req.params.id, me));
    res.json({ exchange: await view(req.params.id, me, req.ctx.now) });
  }),
);

exchangesRouter.post(
  '/:id/cancel',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { reason } = parseBody(cancelExchangeSchema, req.body, M);
    await withTx((tx) => cancelExchange(tx, req.ctx, req.params.id, me, reason));
    res.json({ exchange: await view(req.params.id, me, req.ctx.now) });
  }),
);

exchangesRouter.post(
  '/:id/partial',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { amount, note } = parseBody(partialSchema, req.body, M);
    await withTx((tx) => proposePartial(tx, req.ctx, req.params.id, me, amount, note));
    res.json({ exchange: await view(req.params.id, me, req.ctx.now) });
  }),
);

exchangesRouter.post(
  '/:id/partial/accept',
  ah(async (req, res) => {
    const me = actorId(req, M);
    await withTx((tx) => acceptPartial(tx, req.ctx, req.params.id, me));
    res.json({ exchange: await view(req.params.id, me, req.ctx.now) });
  }),
);
