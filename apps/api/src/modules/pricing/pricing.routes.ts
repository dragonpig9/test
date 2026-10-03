import { Router } from 'express';
import { SERVICE_CATEGORIES, skillClaimSchema, skillReviewSchema } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import { prisma, withTx } from '../../core/db';
import { AppError } from '../../core/errors';
import { actorId, ah, parseBody } from '../../core/http';
import { getMember } from '../members/member.repo';
import { quoteFor } from './pricing.service';
import { createSkillClaim, effectiveSkillTiers, listSkillClaims, reviewSkillClaim } from './pricing.skills';

export const pricingRouter = Router();
const M = 'pricing';

/** Preview a price before proposing. The authoritative quote is recomputed when terms are saved. */
pricingRouter.get(
  '/quote',
  ah(async (req, res) => {
    const q = req.query;
    const category = String(q.category ?? '');
    const durationMinutes = Number(q.durationMinutes);
    if (!(SERVICE_CATEGORIES as readonly string[]).includes(category) || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480 || typeof q.providerId !== 'string') {
      throw new AppError('VALIDATION_FAILED', 'Provide ?providerId, a valid category and durationMinutes (15–480).', M);
    }
    await getMember(prisma, q.providerId);
    const giftBonus = Math.max(0, Math.min(Number(q.giftBonus ?? 0) || 0, POLICY.credits.maxGiftBonus));
    const maxCreditBudget = q.maxCreditBudget ? Number(q.maxCreditBudget) : null;
    res.json({ quote: await quoteFor(prisma, { providerId: q.providerId, category, durationMinutes, giftBonus, maxCreditBudget }, req.ctx.now) });
  }),
);

pricingRouter.get(
  '/policy',
  ah(async (_req, res) => {
    res.json({ pricing: POLICY.pricing });
  }),
);

pricingRouter.get(
  '/skills',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const memberId = typeof req.query.member === 'string' ? req.query.member : me;
    res.json({
      tiers: await effectiveSkillTiers(prisma, memberId),
      claims: await listSkillClaims(prisma, me, req.ctx.now, { memberId }),
    });
  }),
);

pricingRouter.get(
  '/skills/reviewable',
  ah(async (req, res) => {
    res.json({ claims: await listSkillClaims(prisma, actorId(req, M), req.ctx.now, { reviewable: true }) });
  }),
);

pricingRouter.post(
  '/skills',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const input = parseBody(skillClaimSchema, req.body, M);
    const c = await withTx((tx) => createSkillClaim(tx, req.ctx, me, input));
    res.status(201).json({ claimId: c.id });
  }),
);

pricingRouter.post(
  '/skills/:id/review',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { approve, note } = parseBody(skillReviewSchema, req.body, M);
    const status = await withTx((tx) => reviewSkillClaim(tx, req.ctx, req.params.id, me, approve, note));
    res.json({ status });
  }),
);
