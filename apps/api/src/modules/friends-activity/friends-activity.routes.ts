import { Router } from 'express';
import { prisma } from '../../core/db';
import { actorId, ah } from '../../core/http';
import { friendsActivity, parseMonth } from './friends-activity.service';

export const friendsActivityRouter = Router();

/** GET /friends-activity?year=2026&month=10 (defaults to the current Hong Kong month). Read-only. */
friendsActivityRouter.get(
  '/',
  ah(async (req, res) => {
    const { year, month } = parseMonth(req.query, req.ctx.now);
    res.json(await friendsActivity(prisma, actorId(req, 'friends-activity'), year, month, req.ctx.now));
  }),
);
