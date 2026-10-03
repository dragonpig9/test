import { Router } from 'express';
import { joinSchema, loginSchema, studentJoinSchema } from '@commonhours/shared';
import { isDemoMode } from '../../config/demo-mode';
import { prisma, withTx } from '../../core/db';
import { actorId, ah, parseBody } from '../../core/http';
import { permissionsOf } from '../credibility/credibility.service';
import { joinWithInvitation } from '../invitations/invitation.service';
import { getMember, toProfile } from '../members/member.repo';
import { afterJoin, joinAsStudent } from '../onboarding/onboarding.service';
import { STUDENT_TERMS } from '../onboarding/onboarding.terms';
import { admissionView } from '../verification/verification.guards';
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
    // Route 1: "Join with an invitation". The code is validated in every mode (demo mode bypasses
    // verification, never invitation validity).
    const member = await withTx((tx) => joinWithInvitation(tx, req.ctx, input));
    // Students: demo admission (demo mode) or the university email code (normal mode). Email failures never undo the join.
    const after = await afterJoin(req.ctx, member.id, !!input.student);
    res.status(201).json({ token: signToken(member.id), member: toProfile(await getMember(prisma, member.id)), ...after });
  }),
);

/** Route 2: "Join as a student" — no invitation code is asked for or stored. */
authRouter.get('/join/student/terms', (_req, res) => res.json({ terms: STUDENT_TERMS }));

authRouter.post(
  '/join/student',
  ah(async (req, res) => {
    const input = parseBody(studentJoinSchema, req.body, M);
    const member = await withTx((tx) => joinAsStudent(tx, req.ctx, input));
    const after = await afterJoin(req.ctx, member.id, true);
    res.status(201).json({ token: signToken(member.id), member: toProfile(await getMember(prisma, member.id)), ...after });
  }),
);

authRouter.get(
  '/me',
  ah(async (req, res) => {
    const me = await getMember(prisma, actorId(req, M));
    res.json({
      member: toProfile(me),
      permissions: await permissionsOf(prisma, me.id, req.ctx.now),
      demoMode: isDemoMode(),
      admission: admissionView(me, isDemoMode()),
      now: req.ctx.now.toISOString(),
    });
  }),
);
