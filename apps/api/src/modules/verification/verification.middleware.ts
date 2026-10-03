import type { NextFunction, Request, Response } from 'express';
import { isDemoMode } from '../../config/demo-mode';
import { prisma } from '../../core/db';
import { AppError } from '../../core/errors';
import { admissionOf } from './verification.guards';

/**
 * Backend admission check on every authenticated request (after requireAuth). A token proves who
 * you are; this decides whether you may use the app yet. Because it re-reads the member and the
 * demo-mode flag each time, a session started under demo mode loses the bypass as soon as demo
 * mode is switched off.
 *
 * Members who are not admitted yet (normal mode, joined as a student, university email not verified)
 * can still reach what they need to verify, read notifications and leave.
 */
const OPEN_WHILE_UNVERIFIED = ['/students/me', '/notifications', '/withdrawal'];

export async function requireAdmission(req: Request, _res: Response, next: NextFunction) {
  try {
    const id = req.ctx.actorId;
    if (!id) return next();
    if (OPEN_WHILE_UNVERIFIED.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
    const m = await prisma.member.findUnique({
      where: { id },
      select: { status: true, joinRoute: true, accountType: true, university: true, studentEmail: true, studentEmailVerifiedAt: true, studentEmailVerifiedVia: true, demoAdmittedAt: true },
    });
    if (!m) return next();
    if (admissionOf(m, isDemoMode()).admitted) return next();
    next(
      new AppError(
        'VERIFICATION_REQUIRED',
        'Verify your university email to start using CommonHours. Send a code from the verification screen and enter it.',
        'verification',
        { verify: '/students/me/verify/request' },
        403,
      ),
    );
  } catch (e) {
    next(e);
  }
}
