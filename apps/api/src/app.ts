import { existsSync } from 'node:fs';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { demoModeStatus } from './config/demo-mode';
import { env } from './config/env';
import { AppError } from './core/errors';
import { logRequest } from './core/request-log';
import { activityRouter } from './modules/activity/activity.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { circlesRouter } from './modules/circles/circles.routes';
import { communityPoolRouter } from './modules/community-pool/community-pool.routes';
import { dailyJobRouter } from './modules/daily-job/daily-job.routes';
import { studentRouter } from './modules/student/student.routes';
import { contextMiddleware, requireAuth } from './modules/auth/auth.middleware';
import { requireAdmission } from './modules/verification/verification.middleware';
import { authRouter } from './modules/auth/auth.routes';
import { conflictsRouter, disputesRouter } from './modules/attestation/attestation.routes';
import { credibilityRouter } from './modules/credibility/credibility.routes';
import { debugRouter } from './modules/debug/debug.routes';
import { demoRouter } from './modules/demo/demo.routes';
import { exchangesRouter } from './modules/exchanges/exchange.routes';
import { expiryRouter } from './modules/expiry/expiry.routes';
import { invitationsRouter, publicInvitationsRouter } from './modules/invitations/invitation.routes';
import { creditsRouter } from './modules/ledger/ledger.routes';
import { membersRouter } from './modules/members/member.routes';
import { notificationsRouter } from './modules/notifications/notification.routes';
import { pricingRouter } from './modules/pricing/pricing.routes';
import { profilesRouter } from './modules/profiles/profile.routes';
import { eligibilityRouter } from './modules/task-eligibility/eligibility.routes';
import { listingsRouter } from './modules/services/listing.routes';
import { trustRouter } from './modules/trust/trust.routes';
import { vouchesRouter } from './modules/vouches/vouch.routes';
import { withdrawalRouter } from './modules/withdrawal/withdrawal.routes';

/** Maps a URL prefix to its module name for error reports when no AppError carries one. */
function moduleFromPath(path: string) {
  return path.split('/')[2] ?? 'api';
}

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.webOrigin, exposedHeaders: ['x-correlation-id'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use(contextMiddleware);

  // Request log for the Debug panel (no bodies, no tokens).
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      logRequest({
        at: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Date.now() - started,
        correlationId: req.ctx?.correlationId ?? '-',
        actorId: req.ctx?.actorId ?? null,
        errorCode: res.locals.errorCode,
        errorModule: res.locals.errorModule,
        errorMessage: res.locals.errorMessage,
      });
    });
    next();
  });

  // Public configuration the web app reads before sign-in. demoMode comes only from the server's DEMO_MODE.
  app.get('/api/health', (req, res) => res.json({ ok: true, now: req.ctx.now, demoMode: demoModeStatus().enabled, demo: demoModeStatus() }));
  app.use('/api/auth', authRouter);
  app.use('/api/invitations/code', publicInvitationsRouter);
  // The router itself refuses every request while demo mode is off.
  app.use('/api/demo', demoRouter);

  const authed = express.Router();
  authed.use(requireAuth);
  // Re-checked on every request: stale sessions cannot keep a bypass after demo mode is switched off.
  authed.use(requireAdmission);
  authed.use('/members', membersRouter);
  authed.use('/invitations', invitationsRouter);
  authed.use('/vouches', vouchesRouter);
  authed.use('/trust', trustRouter);
  authed.use('/listings', listingsRouter);
  authed.use('/exchanges', exchangesRouter);
  authed.use('/credits', creditsRouter);
  authed.use('/expiry', expiryRouter);
  authed.use('/credibility', credibilityRouter);
  authed.use('/disputes', disputesRouter);
  authed.use('/conflicts', conflictsRouter);
  authed.use('/withdrawal', withdrawalRouter);
  authed.use('/audit', auditRouter);
  authed.use('/profiles', profilesRouter);
  authed.use('/notifications', notificationsRouter);
  authed.use('/pricing', pricingRouter);
  authed.use('/eligibility', eligibilityRouter);
  authed.use('/students', studentRouter);
  authed.use('/circles', circlesRouter);
  authed.use('/activity', activityRouter);
  authed.use('/community-pool', communityPoolRouter);
  authed.use('/daily-job', dailyJobRouter);
  if (env.debugEndpoints) authed.use('/debug', debugRouter);
  app.use('/api', authed);

  app.use('/api', (req, _res, next) => next(new AppError('NOT_FOUND', `No route for ${req.method} ${req.originalUrl}.`, 'api')));

  // Single-service deploys: serve the built web app (apps/web/dist) and send client-side routes to index.html.
  const webDist = env.webDist;
  if (webDist && existsSync(`${webDist}/index.html`)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: webDist }));
  }

  // Uniform error shape: human message + stable code + module + correlation id.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let e: AppError;
    if (err instanceof AppError) e = err;
    else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      e = new AppError('ALREADY_DONE', 'This action was already recorded (duplicate request blocked by a uniqueness rule).', moduleFromPath(req.originalUrl), { target: err.meta?.target }, 409);
    } else if (err instanceof SyntaxError) {
      e = new AppError('VALIDATION_FAILED', 'Request body is not valid JSON.', 'api', undefined, 400);
    } else {
      console.error(`[${req.ctx?.correlationId}]`, err);
      e = new AppError('INTERNAL_ERROR', 'Something went wrong on the server. Use the correlation id to find the log entry.', moduleFromPath(req.originalUrl));
    }
    res.locals.errorCode = e.code;
    res.locals.errorModule = e.module;
    res.locals.errorMessage = e.message;
    res.status(e.status).json({ error: { code: e.code, message: e.message, module: e.module, correlationId: req.ctx?.correlationId, details: e.details } });
  });
  return app;
}
