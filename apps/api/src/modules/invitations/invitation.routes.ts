import { Router } from 'express';
import { createInvitationSchema } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { createInvitation, listInvitations, previewInvitation, revokeInvitation, toInvitationView } from './invitation.service';

export const invitationsRouter = Router();
/** Public: lets a prospective member read the terms before joining. */
export const publicInvitationsRouter = Router();
const M = 'invitations';

publicInvitationsRouter.get(
  '/:code',
  ah(async (req, res) => {
    res.json({ invitation: toInvitationView(await previewInvitation(prisma, req.params.code, req.ctx.now)) });
  }),
);

invitationsRouter.get(
  '/',
  ah(async (req, res) => {
    res.json({ invitations: (await listInvitations(prisma, actorId(req, M))).map(toInvitationView) });
  }),
);

invitationsRouter.post(
  '/',
  ah(async (req, res) => {
    const input = parseBody(createInvitationSchema, req.body, M);
    const inv = await withTx((tx) => createInvitation(tx, req.ctx, actorId(req, M), input));
    res.status(201).json({ invitation: toInvitationView(inv) });
  }),
);

invitationsRouter.post(
  '/:id/revoke',
  ah(async (req, res) => {
    await withTx((tx) => revokeInvitation(tx, req.ctx, req.params.id, actorId(req, M)));
    res.json({ ok: true });
  }),
);
