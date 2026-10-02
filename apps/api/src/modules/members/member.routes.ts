import { Router } from 'express';
import { prisma } from '../../core/db';
import { ah } from '../../core/http';
import { getMember, listMembers, toProfile } from './member.repo';

export const membersRouter = Router();

membersRouter.get(
  '/',
  ah(async (_req, res) => {
    const members = await listMembers(prisma);
    res.json({ members: members.map(toProfile) });
  }),
);

membersRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json({ member: toProfile(await getMember(prisma, req.params.id)) });
  }),
);
