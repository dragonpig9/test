import { Router } from 'express';
import { circleMessageSchema } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { syncCircleMembership } from './circles.membership';
import { circleBoard, circleRoom, myCircle, postCircleMessage } from './circles.service';

export const circlesRouter = Router();
const M = 'circles';

/** My circle. Brings membership up to date first (joins in demo mode, removes access that no longer applies). */
circlesRouter.get(
  '/me',
  ah(async (req, res) => {
    const me = actorId(req, M);
    await withTx((tx) => syncCircleMembership(tx, req.ctx, me, 'opened Circles'));
    res.json(await myCircle(prisma, me));
  }),
);

circlesRouter.get(
  '/:code/messages',
  ah(async (req, res) => {
    res.json(await circleRoom(prisma, actorId(req, M), req.params.code, req.query.tag));
  }),
);

circlesRouter.post(
  '/:code/messages',
  ah(async (req, res) => {
    const input = parseBody(circleMessageSchema, req.body, M);
    const message = await withTx((tx) => postCircleMessage(tx, req.ctx, actorId(req, M), req.params.code, input));
    res.status(201).json({ message });
  }),
);

circlesRouter.get(
  '/:code/board',
  ah(async (req, res) => {
    res.json({ listings: await circleBoard(prisma, actorId(req, M), req.params.code, req.query.tag, req.ctx.now) });
  }),
);
