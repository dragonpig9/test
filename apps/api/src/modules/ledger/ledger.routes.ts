import { Router } from 'express';
import { prisma } from '../../core/db';
import { actorId, ah } from '../../core/http';
import { creditSummary, ledgerEntries } from './ledger.service';

export const creditsRouter = Router();

creditsRouter.get(
  '/summary',
  ah(async (req, res) => {
    res.json(await creditSummary(prisma, actorId(req, 'ledger'), req.ctx.now));
  }),
);

creditsRouter.get(
  '/entries',
  ah(async (req, res) => {
    res.json({ entries: await ledgerEntries(prisma, actorId(req, 'ledger')) });
  }),
);
