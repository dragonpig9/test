import { Router } from 'express';
import { joinSchema, loginSchema } from '@commonhours/shared';
import { env } from '../../config/env';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { permissionsOf } from '../credibility/credibility.service';
import { joinWithInvitation } from '../invitations/invitation.service';
import { getMember, toProfile } from '../members/member.repo';
import { requestStudentEmailCode } from '../student/student.verification';
import { login, signToken } from './auth.service';

export const authRouter = Router();
const M = 'auth';

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const { email, password } = parseBody(loginSchema, req.body, M);
    const { token, member } = await login(prisma, email, password);
    res.json({ token, member: toProfile(member) });
  }),
);

authRouter.post(
  '/join',
  ah(async (req, res) => {
    const input = parseBody(joinSchema, req.body, M);
    const member = await withTx((tx) => joinWithInvitation(tx, req.ctx, input));
    // Student registration: send the university email code right away. Failure (e.g. no email
    // provider) never undoes the join; the member can resend it from their profile.
    let studentVerification: { sentTo: string; delivery: string } | null = null;
    if (input.student) {
      try {
        const r = await withTx((tx) => requestStudentEmailCode(tx, { ...req.ctx, actorId: member.id }, member.id));
        studentVerification = { sentTo: r.sentTo, delivery: r.delivery };
      } catch (e) {
        console.warn(`[${req.ctx.correlationId}] student code not sent after join:`, (e as Error).message);
      }
    }
    res.status(201).json({ token: signToken(member.id), member: toProfile(member), studentVerification });
  }),
);

authRouter.get(
  '/me',
  ah(async (req, res) => {
    const me = await getMember(prisma, actorId(req, M));
    res.json({
      member: toProfile(me),
      permissions: await permissionsOf(prisma, me.id, req.ctx.now),
      demoMode: env.demoMode,
      now: req.ctx.now.toISOString(),
    });
  }),
);
