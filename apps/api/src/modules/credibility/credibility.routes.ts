import { Router } from 'express';
import { prisma } from '../../core/db';
import { actorId, ah } from '../../core/http';
import { getMember } from '../members/member.repo';
import { credibilityView } from './credibility.service';

export const credibilityRouter = Router();

credibilityRouter.get(
  '/me',
  ah(async (req, res) => {
    res.json(await credibilityView(prisma, actorId(req, 'credibility'), req.ctx.now));
  }),
);

credibilityRouter.get(
  '/:memberId',
  ah(async (req, res) => {
    await getMember(prisma, req.params.memberId);
    res.json(await credibilityView(prisma, req.params.memberId, req.ctx.now));
  }),
);
