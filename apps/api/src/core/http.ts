import type { NextFunction, Request, Response, RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors';
import type { Ctx } from './context';

/** Wraps async route handlers so thrown errors reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown, module: string): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AppError(
      'VALIDATION_FAILED',
      `Some fields need attention: ${issues.map((i) => `${i.path || 'body'} — ${i.message}`).join('; ')}`,
      module,
      { issues },
    );
  }
  return r.data;
}

export function ctxOf(req: Request): Ctx {
  return req.ctx;
}

export function actorId(req: Request, module: string): string {
  if (!req.ctx.actorId) throw new AppError('UNAUTHENTICATED', 'Please sign in.', module);
  return req.ctx.actorId;
}
