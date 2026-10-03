import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { DemoReadinessView } from '@commonhours/shared';
import { isDemoMode } from '../../config/demo-mode';
import type { Db } from '../../core/db';
import { AppError } from '../../core/errors';

/**
 * Readiness of the shared demo community.
 *
 * A reset truncates every table and rebuilds the community through ~40 dated service calls, so for a
 * while the database holds a partial community (and no simulated clock). Readiness is kept in two places:
 *  - SystemState.demoStatus, written INITIALIZING in the same transaction as the truncation (so a reader
 *    sees either the old community with its old status, or the empty one marked INITIALIZING) and READY
 *    only after housekeeping and the fixture checks;
 *  - an in-process flag, set before anything is written, so this server never reports READY while it is
 *    itself rebuilding the community.
 * Every seed writes the row before it truncates, and the truncation itself re-creates it as INITIALIZING in
 * the same transaction, so a missing row only means the demo seed never ran here (e.g. a test database);
 * that is reported as READY with no seed version, and the walkthrough answers "not seeded".
 */
let preparingHere = false;

export function setPreparingHere(on: boolean) {
  preparingHere = on;
}

export async function demoReadiness(db: Db): Promise<DemoReadinessView> {
  const s = await db.systemState.findUnique({ where: { id: 1 } });
  if (preparingHere) {
    return { status: 'INITIALIZING', seedVersion: null, detail: s?.demoStatusDetail ?? 'Preparing the demo community.', since: s?.demoStatusAt?.toISOString() ?? null };
  }
  if (!s) return { status: 'READY', seedVersion: null, detail: null, since: null };
  return {
    status: s.demoStatus,
    seedVersion: s.demoStatus === 'READY' ? (s.seededAt?.toISOString() ?? null) : null,
    detail: s.demoStatusDetail,
    since: s.demoStatusAt?.toISOString() ?? null,
  };
}

export async function markDemoStatus(prisma: PrismaClient, status: DemoReadinessView['status'], detail: string | null, seededAt?: Date) {
  const at = new Date();
  await prisma.systemState.upsert({
    where: { id: 1 },
    create: { id: 1, demoStatus: status, demoStatusDetail: detail, demoStatusAt: at, ...(seededAt ? { seededAt } : {}) },
    update: { demoStatus: status, demoStatusDetail: detail, demoStatusAt: at, ...(seededAt ? { seededAt } : {}) },
  });
}

/** Throws the error a demo action gets while the community is not READY. */
export function notReadyError(r: DemoReadinessView, module = 'demo') {
  return r.status === 'FAILED'
    ? new AppError('DEMO_FAILED', `Preparing the demo examples failed${r.detail ? `: ${r.detail.replace(/\.$/, '')}` : ''}. Reset the demo to try again.`, module, { readiness: r })
    : new AppError('DEMO_PREPARING', 'The demo examples are being prepared. Please try again in a moment.', module, { readiness: r });
}

/** True when background jobs may process the community (always outside demo mode). */
export async function demoReadyForJobs(db: Db) {
  if (!isDemoMode()) return true;
  return (await demoReadiness(db)).status === 'READY';
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Demo mode: no action (any write) runs against a partially rebuilt community. Reads stay open, and the
 * reset endpoint keeps its own lock so a FAILED preparation can be retried.
 */
export function demoActionGate(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!isDemoMode() || SAFE.has(req.method) || req.path === '/api/demo/reset') return next();
      const r = await demoReadiness(db);
      if (r.status !== 'READY') return next(notReadyError(r, req.path.split('/')[2] ?? 'api'));
      next();
    } catch (e) {
      next(e);
    }
  };
}
