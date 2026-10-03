import { Router } from 'express';
import { notificationPrefsSchema } from '@commonhours/shared';
import { prisma } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { listNotifications, markAllRead, markRead, outboxFor, preferencesOf, updatePreferences } from './notification.service';

export const notificationsRouter = Router();
const M = 'notifications';

notificationsRouter.get(
  '/',
  ah(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    res.json(await listNotifications(prisma, actorId(req, M), { limit, unreadOnly: req.query.unread === 'true' }));
  }),
);

notificationsRouter.get(
  '/unread-count',
  ah(async (req, res) => {
    res.json({ unread: await prisma.notification.count({ where: { memberId: actorId(req, M), readAt: null } }) });
  }),
);

notificationsRouter.post(
  '/read-all',
  ah(async (req, res) => {
    res.json({ marked: await markAllRead(actorId(req, M), req.ctx.now) });
  }),
);

notificationsRouter.post(
  '/:id/read',
  ah(async (req, res) => {
    await markRead(actorId(req, M), req.params.id, req.ctx.now);
    res.json({ ok: true });
  }),
);

notificationsRouter.get(
  '/preferences',
  ah(async (req, res) => {
    res.json(await preferencesOf(prisma, actorId(req, M)));
  }),
);

notificationsRouter.put(
  '/preferences',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { emailEnabled, categories } = parseBody(notificationPrefsSchema, req.body, M);
    await updatePreferences(me, emailEnabled, categories);
    res.json(await preferencesOf(prisma, me));
  }),
);

/** The signed-in member's own emails (previews in demo mode, delivery status otherwise). */
notificationsRouter.get(
  '/outbox',
  ah(async (req, res) => {
    res.json({ emails: await outboxFor(prisma, actorId(req, M)) });
  }),
);
