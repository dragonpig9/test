import { Router } from 'express';
import { advanceClockSchema, switchAccountSchema } from '@commonhours/shared';
import { env } from '../../config/env';
import { prisma, withTx } from '../../core/db';
import { AppError } from '../../core/errors';
import { ah, parseBody } from '../../core/http';
import { signToken } from '../auth/auth.service';
import { toProfile } from '../members/member.repo';
import { DEMO_EXTRAS, advanceClock, demoGuide, resetDemo, runSweeps } from './demo.service';

export const demoRouter = Router();
const M = 'demo';

demoRouter.use((_req, _res, next) => {
  if (!env.demoMode) return next(new AppError('DEMO_DISABLED', 'Demo mode is disabled on this server.', M));
  next();
});

demoRouter.get(
  '/state',
  ah(async (req, res) => {
    const s = await prisma.systemState.findUnique({ where: { id: 1 } });
    const members = await prisma.member.findMany({ orderBy: { joinedAt: 'asc' } });
    res.json({
      demoMode: true,
      now: req.ctx.now.toISOString(),
      simulated: !!s?.simulatedNow,
      seededAt: s?.seededAt?.toISOString() ?? null,
      members: members.map(toProfile),
      guide: await demoGuide(req.ctx.now),
      extras: DEMO_EXTRAS,
    });
  }),
);

/** Clearly-labelled demo account switcher. Issues a normal JWT for a seeded member. */
demoRouter.post(
  '/switch',
  ah(async (req, res) => {
    const { handle } = parseBody(switchAccountSchema, req.body, M);
    const m = await prisma.member.findUnique({ where: { handle } });
    if (!m) throw new AppError('NOT_FOUND', `No member with handle ${handle}.`, M);
    res.json({ token: signToken(m.id), member: toProfile(m) });
  }),
);

demoRouter.post(
  '/reset',
  ah(async (_req, res) => {
    await resetDemo();
    res.json({ ok: true });
  }),
);

demoRouter.post(
  '/clock/advance',
  ah(async (req, res) => {
    const { days } = parseBody(advanceClockSchema, req.body, M);
    const r = await withTx((tx) => advanceClock(tx, req.ctx, days));
    res.json(r);
  }),
);

demoRouter.post(
  '/sweeps',
  ah(async (req, res) => {
    res.json(await withTx((tx) => runSweeps(tx, req.ctx)));
  }),
);
