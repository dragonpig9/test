import { Router } from 'express';
import { prisma } from '../../core/db';
import { actorId, ah } from '../../core/http';
import { communityPoolView } from './community-pool.service';

export const communityPoolRouter = Router();

communityPoolRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await communityPoolView(prisma, actorId(req, 'community-pool'), req.ctx.now));
  }),
);
