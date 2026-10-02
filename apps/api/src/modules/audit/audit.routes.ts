import { Router } from 'express';
import { prisma } from '../../core/db';
import { actorId, ah } from '../../core/http';
import { listAudit } from './audit.repo';

export const auditRouter = Router();

/** Activity feed. `scope=mine` (default) shows events involving the signed-in member; `scope=all` the whole community. */
auditRouter.get(
  '/',
  ah(async (req, res) => {
    const me = actorId(req, 'audit');
    const scope = req.query.scope === 'all' ? 'all' : 'mine';
    const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : undefined;
    const events = await listAudit(prisma, {
      involvingMemberId: scope === 'mine' && !entityId ? me : undefined,
      entityId,
      limit: 300,
    });
    res.json({ events });
  }),
);
