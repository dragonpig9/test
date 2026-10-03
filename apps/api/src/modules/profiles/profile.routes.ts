import { Router } from 'express';
import { profileUpdateSchema, verifyEmailSchema } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { AppError } from '../../core/errors';
import { actorId, ah, parseBody } from '../../core/http';
import { profileView, updateProfile } from './profile.service';
import { confirmEmailVerification, requestEmailVerification, requestPhoneVerification } from './profile.verification';

export const profilesRouter = Router();
const M = 'profiles';

profilesRouter.get(
  '/me',
  ah(async (req, res) => {
    const me = actorId(req, M);
    res.json({ profile: await profileView(prisma, me, me, req.ctx.now) });
  }),
);

profilesRouter.put(
  '/me',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const input = parseBody(profileUpdateSchema, req.body, M);
    await withTx((tx) => updateProfile(tx, req.ctx, me, input));
    res.json({ profile: await profileView(prisma, me, me, req.ctx.now) });
  }),
);

profilesRouter.post(
  '/me/verify-email/request',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const r = await withTx((tx) => requestEmailVerification(tx, req.ctx, me));
    // The code itself is never returned: it travels only through the email (or the demo preview).
    res.json({ sentTo: r.sentTo, delivery: r.delivery });
  }),
);

profilesRouter.post(
  '/me/verify-email/confirm',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { code } = parseBody(verifyEmailSchema, req.body, M);
    const r = await withTx((tx) => confirmEmailVerification(tx, req.ctx, me, code));
    if (!r.verified) throw new AppError('VERIFICATION_FAILED', `That code is not correct. ${r.attemptsLeft} attempt(s) left.`, M);
    res.json({ profile: await profileView(prisma, me, me, req.ctx.now) });
  }),
);

profilesRouter.post(
  '/me/verify-phone/request',
  ah(async () => {
    requestPhoneVerification();
  }),
);

profilesRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json({ profile: await profileView(prisma, req.params.id, actorId(req, M), req.ctx.now) });
  }),
);
