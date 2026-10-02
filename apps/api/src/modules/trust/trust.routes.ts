import { Router } from 'express';
import { prisma } from '../../core/db';
import { AppError } from '../../core/errors';
import { ah } from '../../core/http';
import { findPath, graphView, loadTrust } from './trust.service';

export const trustRouter = Router();

trustRouter.get(
  '/graph',
  ah(async (req, res) => {
    res.json(graphView(await loadTrust(prisma, req.ctx.now)));
  }),
);

trustRouter.get(
  '/path',
  ah(async (req, res) => {
    const { from, to } = req.query;
    if (typeof from !== 'string' || typeof to !== 'string') {
      throw new AppError('VALIDATION_FAILED', 'Provide ?from=<memberId>&to=<memberId>.', 'trust');
    }
    res.json(findPath(await loadTrust(prisma, req.ctx.now), from, to));
  }),
);
