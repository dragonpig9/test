import { Router } from 'express';
import { createListingSchema, SERVICE_CATEGORIES } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { loadTrust, reachFrom } from '../trust/trust.service';
import { createListing, discoverListings, getListing, toListingView, withdrawListing } from './listing.service';

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
    });
    res.json({ listings, categories: SERVICE_CATEGORIES });
  }),
);

listingsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const l = await getListing(prisma, req.params.id);
    const r = reachFrom(await loadTrust(prisma, req.ctx.now), me).get(l.ownerId);
    res.json({ listing: { ...toListingView(l), reachability: { reachable: !!r, hops: r?.hops ?? null, strength: r?.strength ?? null } } });
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
