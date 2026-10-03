import { Router } from 'express';
import { createListingSchema, SERVICE_CATEGORIES, TOPIC_TAGS } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { AppError } from '../../core/errors';
import { actorId, ah, parseBody } from '../../core/http';
import { createListing, discoverListings, toListingView, withdrawListing } from './listing.service';

export const listingsRouter = Router();
const M = 'services';

listingsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = req.query;
    const listings = await discoverListings(prisma, actorId(req, M), req.ctx.now, {
      category: typeof q.category === 'string' && q.category ? q.category : undefined,
      type: q.type === 'OFFER' || q.type === 'REQUEST' ? q.type : undefined,
      reachableOnly: q.reachableOnly === 'true',
      mine: q.mine === 'true',
      ownerId: typeof q.owner === 'string' && q.owner ? q.owner : undefined,
      maxHops: typeof q.maxHops === 'string' && q.maxHops ? Number(q.maxHops) : undefined,
      tag: typeof q.tag === 'string' && (TOPIC_TAGS as readonly string[]).includes(q.tag) ? q.tag : undefined,
    });
    res.json({ listings, categories: SERVICE_CATEGORIES, tags: TOPIC_TAGS });
  }),
);

listingsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const all = await discoverListings(prisma, me, req.ctx.now, {});
    const l = all.find((x) => x.id === req.params.id);
    if (!l) throw new AppError('NOT_FOUND', 'Listing was not found or is no longer open.', M);
    res.json({ listing: l });
  }),
);

listingsRouter.post(
  '/',
  ah(async (req, res) => {
    const input = parseBody(createListingSchema, req.body, M);
    const l = await withTx((tx) => createListing(tx, req.ctx, actorId(req, M), input));
    res.status(201).json({ listing: toListingView(l) });
  }),
);

listingsRouter.post(
  '/:id/withdraw',
  ah(async (req, res) => {
    const l = await withTx((tx) => withdrawListing(tx, req.ctx, req.params.id, actorId(req, M)));
    res.json({ listing: toListingView(l) });
  }),
);
