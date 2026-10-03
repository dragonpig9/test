import { Router } from 'express';
import { prisma } from '../../core/db';
import { actorId, ah } from '../../core/http';
import { friendsLeaderboard } from './activity.service';

export const activityRouter = Router();

/** Computed from settled exchanges on every request, so it is current right after a qualifying exchange. */
activityRouter.get(
  '/leaderboard',
  ah(async (req, res) => {
    res.json(await friendsLeaderboard(prisma, actorId(req, 'activity'), req.ctx.now));
  }),
);
