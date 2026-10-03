import { Router } from 'express';
import { badgeVisibilitySchema } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { myBadges, setBadgeVisibility } from './badges.service';

export const badgesRouter = Router();
const M = 'badges';

badgesRouter.get(
  '/me',
  ah(async (req, res) => {
    res.json(await myBadges(prisma, actorId(req, M)));
  }),
);

badgesRouter.put(
  '/me/visibility',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { showBadges } = parseBody(badgeVisibilitySchema, req.body, M);
    await withTx((tx) => setBadgeVisibility(tx, req.ctx, me, showBadges));
    res.json(await myBadges(prisma, me));
  }),
);
