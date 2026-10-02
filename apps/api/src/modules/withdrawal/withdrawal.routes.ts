import { Router } from 'express';
import { leaveSchema } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { toProfile } from '../members/member.repo';
import { leaveCommunity, withdrawalPreview } from './withdrawal.service';

export const withdrawalRouter = Router();
const M = 'withdrawal';

withdrawalRouter.get(
  '/preview',
  ah(async (req, res) => {
    res.json(await withdrawalPreview(prisma, actorId(req, M), req.ctx.now));
  }),
);

withdrawalRouter.post(
  '/leave',
  ah(async (req, res) => {
    const { reason } = parseBody(leaveSchema, req.body, M);
    const m = await withTx((tx) => leaveCommunity(tx, req.ctx, actorId(req, M), reason));
    res.json({ member: toProfile(m) });
  }),
);
