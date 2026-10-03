import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeStudentEmail, UNIVERSITIES } from '@commonhours/shared';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/core/db';
import { setEmailProviderForTests } from '../src/modules/notifications/email.provider';
import { confirmStudentEmailCode, requestStudentEmailCode } from '../src/modules/student/student.verification';
import { T0, community, reset, run } from './fixtures';

const app = createApp();
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const studentBody = (handle: string, university = 'HKU', localPart = handle) => ({
  displayName: handle[0].toUpperCase() + handle.slice(1),
  handle,
  password: 'student-password',
  acceptCommunityTerms: true,
  student: { university, studentEmail: composeStudentEmail(university as 'HKU', localPart), currentStudentDeclaration: true },
});

afterEach(() => {
  env.demoMode = true;
  env.devShortcuts = true;
  setEmailProviderForTests(null);
});

describe('university configuration', () => {
  it('maps the eight universities to their fixed suffixes in one module', () => {
    expect(UNIVERSITIES.map((u) => `${u.code}@${u.domain}`)).toEqual([
      'HKU@connect.hku.hk',
      'CUHK@link.cuhk.edu.hk',
      'HKUST@connect.ust.hk',
      'PolyU@connect.polyu.hk',
      'CityU@my.cityu.edu.hk',
      'HKBU@life.hkbu.edu.hk',
      'Lingnan@ln.hk',
      'EdUHK@s.eduhk.hk',
    ]);
    expect(UNIVERSITIES.find((u) => u.code === 'HKU')!.name).toBe('University of Hong Kong');
    // Pasting a whole address keeps only the username: never a duplicated domain.
    expect(composeStudentEmail('HKU', 'abc@connect.hku.hk')).toBe('abc@connect.hku.hk');
  });
});

describe('two ways to join', () => {
  beforeEach(async () => {
    await reset();
    await community(['alice', 'ben']);
  });

  it('demo mode: a student joins without an invitation or an email and enters the app immediately', async () => {
    const r = await request(app).post('/api/auth/join/student').send(studentBody('hana'));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ demoAdmitted: true, studentVerification: null });
    expect(r.body.notice).toMatch(/Nothing was emailed/);
    expect(r.body.member).toMatchObject({ university: 'HKU', universityEmailVerified: false, demoBadge: 'Demo student' });
    // Straight into the app.
    expect((await request(app).get('/api/credits/summary').set(bearer(r.body.token))).body.posted).toBe(0);
    const m = await prisma.member.findUniqueOrThrow({ where: { handle: 'hana' } });
    expect(m).toMatchObject({ joinRoute: 'STUDENT', accountType: 'STUDENT', email: 'hana@connect.hku.hk', studentEmailVerifiedAt: null });
    expect(m.demoAdmittedAt).not.toBeNull();
    // No fake invitation, no inviter relationship, no vouch, no email.
    expect(await prisma.invitation.count({ where: { acceptedById: m.id } })).toBe(0);
    expect(await prisma.vouch.count({ where: { OR: [{ voucheeId: m.id }, { voucherId: m.id }] } })).toBe(0);
    expect(await prisma.emailOutbox.count({ where: { memberId: m.id } })).toBe(0);
  });

  it('validates the university domain and the username on the backend', async () => {
    const wrongDomain = { ...studentBody('ivy'), student: { university: 'HKU', studentEmail: 'ivy@link.cuhk.edu.hk', currentStudentDeclaration: true } };
    expect((await request(app).post('/api/auth/join/student').send(wrongDomain)).body.error.code).toBe('VALIDATION_FAILED');
    const doubleAt = { ...studentBody('ivy'), student: { university: 'HKU', studentEmail: 'ivy@x@connect.hku.hk', currentStudentDeclaration: true } };
    expect((await request(app).post('/api/auth/join/student').send(doubleAt)).status).toBe(400);
    const unknown = { ...studentBody('ivy'), student: { university: 'MIT', studentEmail: 'ivy@mit.edu', currentStudentDeclaration: true } };
    expect((await request(app).post('/api/auth/join/student').send(unknown)).status).toBe(400);
    const noDeclaration = { ...studentBody('ivy'), student: { ...studentBody('ivy').student, currentStudentDeclaration: false } };
    expect((await request(app).post('/api/auth/join/student').send(noDeclaration)).status).toBe(400);
    // A second account cannot reuse the same university mailbox.
    expect((await request(app).post('/api/auth/join/student').send(studentBody('ivy'))).status).toBe(201);
    expect((await request(app).post('/api/auth/join/student').send({ ...studentBody('ivy2', 'HKU', 'ivy') })).status).toBe(409);
  });

  it('invitation signup still validates its code, even in demo mode', async () => {
    const body = { code: 'NOPE-0000', displayName: 'Zed', handle: 'zed', email: 'zed@t.test', password: 'zed-password', acceptCommunityTerms: true, acceptVouchTerms: true };
    const bad = await request(app).post('/api/auth/join').send(body);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVITATION_INVALID');
    await prisma.invitation.create({ data: { code: 'GOOD-0001', inviterId: (await prisma.member.findUniqueOrThrow({ where: { handle: 'alice' } })).id, inviteeName: 'Zed', strength: 0.7, liabilityPct: 20, termsVersion: 't', createdAt: T0, expiresAt: new Date(T0.getTime() + 864e5) } });
    const ok = await request(app).post('/api/auth/join').send({ ...body, code: 'GOOD-0001' });
    expect(ok.status).toBe(201);
    expect(await prisma.vouch.count({ where: { voucheeId: ok.body.member.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('normal mode: student access needs genuine university email verification; no email is claimed when none was sent', async () => {
    env.demoMode = false;
    env.devShortcuts = false; // no development preview, no provider
    const r = await request(app).post('/api/auth/join/student').send(studentBody('jo'));
    expect(r.status).toBe(201); // signup is not blocked by missing email delivery
    expect(r.body).toMatchObject({ demoAdmitted: false, studentVerification: null });
    expect(r.body.notice).toMatch(/^No email was sent/);
    const token = bearer(r.body.token);
    expect((await request(app).get('/api/credits/summary').set(token)).body.error.code).toBe('VERIFICATION_REQUIRED');

    // Genuine verification through a real (fake) provider admits the account.
    setEmailProviderForTests({ name: 'fake', send: async () => ({ messageId: 'x' }) });
    const id = r.body.member.id as string;
    const sent = await run(id, T0, (tx, ctx) => requestStudentEmailCode(tx, ctx, id));
    expect(sent.delivery).toBe('smtp');
    await run(id, T0, (tx, ctx) => confirmStudentEmailCode(tx, ctx, id, sent.code));
    expect((await request(app).get('/api/credits/summary').set(token)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(token)).body.member).toMatchObject({ universityEmailVerified: true, demoBadge: null });
  });
});
