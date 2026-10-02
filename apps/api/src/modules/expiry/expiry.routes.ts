import { Router } from 'express';
import { prisma } from '../../core/db';
import { actorId, ah } from '../../core/http';
import { expiryPreview } from './expiry.service';

export const expiryRouter = Router();

expiryRouter.get(
  '/preview',
  ah(async (req, res) => {
    res.json(await expiryPreview(prisma, actorId(req, 'expiry'), req.ctx.now));
  }),
);
