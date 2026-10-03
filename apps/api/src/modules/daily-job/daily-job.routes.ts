import { Router } from 'express';
import { prisma } from '../../core/db';
import { ah } from '../../core/http';
import { recentRuns } from './daily-job.service';

/** Read-only run history (counts and statuses only; no member data). */
export const dailyJobRouter = Router();

dailyJobRouter.get(
  '/runs',
  ah(async (_req, res) => {
    res.json({ runs: await recentRuns(prisma) });
  }),
);
