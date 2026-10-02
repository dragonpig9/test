import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../core/db';
import { readClock } from '../../core/context';
import { AppError } from '../../core/errors';
import { verifyToken } from './auth.service';

/** Attaches a request context: correlation id, domain clock and (if a valid JWT is present) the actor. */
export async function contextMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const incoming = req.header('x-correlation-id');
    const correlationId = incoming && /^[\w-]{6,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-correlation-id', correlationId);
    const auth = req.header('authorization');
    let actorId: string | null = null;
    if (auth?.startsWith('Bearer ')) {
      const id = verifyToken(auth.slice(7));
      if (id && (await prisma.member.findUnique({ where: { id }, select: { id: true } }))) actorId = id;
    }
    req.ctx = { correlationId, actorId, now: await readClock(prisma) };
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.ctx?.actorId) return next(new AppError('UNAUTHENTICATED', 'Please sign in to continue.', 'auth'));
  next();
}
