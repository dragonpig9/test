import { Router } from 'express';
import { studentDetailsSchema, verifyEmailSchema } from '@commonhours/shared';
import { prisma, withTx } from '../../core/db';
import { AppError } from '../../core/errors';
import { actorId, ah, parseBody } from '../../core/http';
import { setStudentDetails, studentStatus } from './student.service';
import { confirmStudentEmailCode, requestStudentEmailCode } from './student.verification';

export const studentRouter = Router();
const M = 'student';

studentRouter.get(
  '/me',
  ah(async (req, res) => {
    res.json({ student: await studentStatus(prisma, actorId(req, M)) });
  }),
);

/** Add or change student details (existing members). Changing university/email resets verification. */
studentRouter.put(
  '/me',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const input = parseBody(studentDetailsSchema, req.body, M);
    const r = await withTx((tx) => setStudentDetails(tx, req.ctx, me, input));
    res.json({ student: await studentStatus(prisma, me), verificationReset: r.verificationReset });
  }),
);

studentRouter.post(
  '/me/verify/request',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const r = await withTx((tx) => requestStudentEmailCode(tx, req.ctx, me));
    // The code is never returned: it travels only by email (or the development preview).
    res.json({ sentTo: r.sentTo, delivery: r.delivery });
  }),
);

studentRouter.post(
  '/me/verify/confirm',
  ah(async (req, res) => {
    const me = actorId(req, M);
    const { code } = parseBody(verifyEmailSchema, req.body, M);
    const r = await withTx((tx) => confirmStudentEmailCode(tx, req.ctx, me, code));
    if (!r.verified) throw new AppError('VERIFICATION_FAILED', `That code is not correct. ${r.attemptsLeft} attempt(s) left.`, M);
    res.json({ student: await studentStatus(prisma, me) });
  }),
);
