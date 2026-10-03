import { Router } from 'express';
import { POLICY } from '../../config/policy';
import { prisma } from '../../core/db';
import { actorId, ah } from '../../core/http';
import { scoreOf } from '../credibility/credibility.service';
import { getMember } from '../members/member.repo';
import { getListing } from '../services/listing.service';
import { tierPermissions } from './eligibility.rules';
import { listingEligibility } from './eligibility.service';

export const eligibilityRouter = Router();
const M = 'task-eligibility';

/** The tier table (thresholds and conditions) plus the viewer's score against each tier. */
eligibilityRouter.get(
  '/tiers',
  ah(async (req, res) => {
    const score = await scoreOf(prisma, actorId(req, M), req.ctx.now);
    res.json({ tiers: POLICY.taskEligibility.tiers, score, permissions: tierPermissions(score) });
  }),
);

eligibilityRouter.get(
  '/listings/:id',
  ah(async (req, res) => {
    const viewer = await getMember(prisma, actorId(req, M));
    const l = await getListing(prisma, req.params.id);
    res.json({ eligibility: (await listingEligibility(prisma, viewer, [l], req.ctx.now)).get(l.id) ?? null });
  }),
);
