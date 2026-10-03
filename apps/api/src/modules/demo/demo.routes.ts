import { Router } from 'express';
import { advanceClockSchema, switchAccountSchema } from '@commonhours/shared';
import { isDemoMode } from '../../config/demo-mode';
import { env } from '../../config/env';
import { prisma, withTx } from '../../core/db';
import { AppError } from '../../core/errors';
import { ah, parseBody } from '../../core/http';
import { signToken } from '../auth/auth.service';
import { toProfile } from '../members/member.repo';
import { addDays } from '../../core/dates';
import { nextRunAt } from '../community-pool/community-pool.service';
import { runDailyJobsBetween, runDueDailyJob } from '../daily-job/daily-job.service';
import { DEMO_EXTRAS, advanceClock, advanceClockTo, demoGuide, resetDemo, runSweeps } from './demo.service';

export const demoRouter = Router();
const M = 'demo';

demoRouter.use((_req, _res, next) => {
  if (!isDemoMode()) return next(new AppError('DEMO_DISABLED', 'Demo mode is disabled on this server.', M));
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
      devShortcuts: env.devShortcuts,
      nextDailyRunAt: nextRunAt(req.ctx.now).toISOString(),
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

// The public demo lets anyone reset, so one reset runs at a time with a short cooldown after it.
const RESET_COOLDOWN_MS = 15_000;
let resetRunning = false;
let lastResetAt = 0;

demoRouter.post(
  '/reset',
  ah(async (_req, res) => {
    const wait = Math.ceil((lastResetAt + RESET_COOLDOWN_MS - Date.now()) / 1000);
    if (resetRunning || wait > 0) {
      throw new AppError('RATE_LIMITED', resetRunning ? 'A demo reset is already running. Try again in a few seconds.' : `The demo was just reset. Try again in ${wait}s.`, M);
    }
    resetRunning = true;
    try {
      await resetDemo();
    } finally {
      resetRunning = false;
      lastResetAt = Date.now();
    }
    res.json({ ok: true });
  }),
);

demoRouter.post(
  '/clock/advance',
  ah(async (req, res) => {
    const { days } = parseBody(advanceClockSchema, req.body, M);
    // Server behaviour, not a demo shortcut: every 00:00 (Hong Kong) the clock passes runs the daily job
    // at that moment, in order, before the clock lands on its new time.
    const dailyJobs = await runDailyJobsBetween(req.ctx.now, addDays(req.ctx.now, days), 'clock-advance');
    const r = await withTx((tx) => advanceClock(tx, req.ctx, days));
    res.json({ ...r, dailyJobs });
  }),
);

// ───── development-only controls (never available when NODE_ENV=production) ─────

const devOnly = () => {
  if (!env.devShortcuts) throw new AppError('DEMO_DISABLED', 'This control is only available in development.', M);
};

/** Moves the simulated clock to the next 00:00 Hong Kong time, which runs the daily job there. */
demoRouter.post(
  '/clock/next-daily-run',
  ah(async (req, res) => {
    devOnly();
    const after = nextRunAt(req.ctx.now);
    const dailyJobs = await runDailyJobsBetween(req.ctx.now, after, 'clock-advance');
    const r = await withTx((tx) => advanceClockTo(tx, req.ctx, after, 'to the next daily run'));
    res.json({ ...r, dailyJobs });
  }),
);

/** Runs (or, if already completed, shows) the daily job for the current Hong Kong date. Idempotent. */
demoRouter.post(
  '/daily-job/run',
  ah(async (req, res) => {
    devOnly();
    res.json(await runDueDailyJob(req.ctx.now, 'manual'));
  }),
);

demoRouter.post(
  '/sweeps',
  ah(async (req, res) => {
    res.json(await withTx((tx) => runSweeps(tx, req.ctx)));
  }),
);
