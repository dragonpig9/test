import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/core/db';
import { signToken } from '../src/modules/auth/auth.service';
import { evaluateTaskEligibility } from '../src/modules/task-eligibility/eligibility.rules';
import { admissionOf, contactRequirementMet, demoBadgeOf, universityAccessOf, type GuardMember } from '../src/modules/verification/verification.guards';
import { recordDemoAdmission } from '../src/modules/verification/verification.service';
import { T0, community, reset, run } from './fixtures';

const app = createApp();
const auth = (id: string) => ({ authorization: `Bearer ${signToken(id)}` });

const pendingStudent: GuardMember = {
  status: 'ACTIVE',
  joinRoute: 'STUDENT',
  accountType: 'STUDENT',
  university: 'HKU',
  studentEmail: 'xxx@connect.hku.hk',
  studentEmailVerifiedAt: null,
  studentEmailVerifiedVia: null,
  demoAdmittedAt: null,
};

describe('verification guards (pure)', () => {
  it('demo mode bypasses verification prerequisites only', () => {
    expect(admissionOf(pendingStudent, false)).toEqual({ admitted: false, via: null });
    expect(admissionOf(pendingStudent, true)).toEqual({ admitted: true, via: 'DEMO_BYPASS' });
    expect(admissionOf({ ...pendingStudent, joinRoute: 'INVITATION' }, false)).toEqual({ admitted: true, via: 'INVITATION' });
    expect(universityAccessOf(pendingStudent, true)).toMatchObject({ allowed: true, via: 'DEMO_SELF_DECLARED' });
    expect(universityAccessOf(pendingStudent, false)).toMatchObject({ allowed: false, via: null });
    // Account status is never bypassed.
    expect(universityAccessOf({ ...pendingStudent, status: 'LEFT' }, true).allowed).toBe(false);
    expect(contactRequirementMet('UNVERIFIED', true)).toEqual({ met: true, bypassed: true });
    expect(contactRequirementMet('UNVERIFIED', false)).toEqual({ met: false, bypassed: false });
    expect(contactRequirementMet('VERIFIED', false)).toEqual({ met: true, bypassed: false });
  });

  it('a previous demo admission never counts as verification once demo mode is off', () => {
    const admitted = { ...pendingStudent, demoAdmittedAt: T0 };
    expect(admissionOf(admitted, false).admitted).toBe(false);
    expect(universityAccessOf(admitted, false).allowed).toBe(false);
    // A development-preview code is not genuine either.
    expect(admissionOf({ ...pendingStudent, studentEmailVerifiedAt: T0, studentEmailVerifiedVia: 'dev-preview' }, false).admitted).toBe(false);
    expect(admissionOf({ ...pendingStudent, studentEmailVerifiedAt: T0, studentEmailVerifiedVia: 'email-code' }, false)).toEqual({ admitted: true, via: 'VERIFIED_EMAIL' });
  });

  it('labels demo admissions "Demo student"/"Demo member", never verified', () => {
    expect(demoBadgeOf({ accountType: 'STUDENT', demoAdmittedAt: T0, studentEmailVerifiedAt: null, studentEmailVerifiedVia: null })).toBe('Demo student');
    expect(demoBadgeOf({ accountType: 'STANDARD', demoAdmittedAt: T0, studentEmailVerifiedAt: null, studentEmailVerifiedVia: null })).toBe('Demo member');
    expect(demoBadgeOf({ accountType: 'STUDENT', demoAdmittedAt: null, studentEmailVerifiedAt: null, studentEmailVerifiedVia: null })).toBeNull();
    // Genuinely verified later: the normal verified badge replaces the demo label.
    expect(demoBadgeOf({ accountType: 'STUDENT', demoAdmittedAt: T0, studentEmailVerifiedAt: T0, studentEmailVerifiedVia: 'email-code' })).toBeNull();
  });

  it('high-trust tasks skip only the contact prerequisite in demo mode', () => {
    const base = {
      tier: 'HIGH_TRUST' as const,
      category: 'Other',
      requesterName: 'Owner',
      requesterMinCredibility: null,
      requesterMinRelationshipTrust: null,
      relationshipTrust: 0,
      ownerApproval: { approved: false },
    };
    const ok = evaluateTaskEligibility({ ...base, provider: { name: 'P', active: true, score: 40, contact: 'UNVERIFIED' }, demoMode: true });
    expect(ok.checks.find((c) => c.key === 'verifiedContact')!.passed).toBe(true);
    expect(ok.eligible).toBe(false); // owner approval still required
    const lowScore = evaluateTaskEligibility({ ...base, provider: { name: 'P', active: true, score: 10, contact: 'UNVERIFIED' }, demoMode: true });
    expect(lowScore.locked).toBe(true); // credibility still applies
  });
});

describe('demo mode on the API', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await reset();
    ids = await community(['alice', 'ben', 'cat']);
    // A pending-verification student-route account (as created by "Join as a student").
    await prisma.member.update({
      where: { id: ids.cat },
      data: { joinRoute: 'STUDENT', accountType: 'STUDENT', university: 'HKU', studentEmail: 'cat@connect.hku.hk' },
    });
  });
  afterEach(() => {
    env.demoMode = true;
  });

  it('exposes the server flag; clients cannot switch it on', async () => {
    env.demoMode = false;
    const h = await request(app).get('/api/health?demoMode=true').set('x-demo-mode', 'true');
    expect(h.body).toMatchObject({ demoMode: false, demo: { enabled: false, bypasses: [] } });
    expect((await request(app).post('/api/demo/switch?demoMode=true').send({ handle: 'alice' })).status).toBe(404);
    env.demoMode = true;
    expect((await request(app).get('/api/health')).body.demoMode).toBe(true);
  });

  it('pending accounts can use the app in demo mode and are blocked again when it is off (stale sessions too)', async () => {
    const token = auth(ids.cat);
    const me = await request(app).get('/api/auth/me').set(token);
    expect(me.body.admission).toMatchObject({ demoMode: true, admitted: true, admittedVia: 'DEMO_BYPASS', showVerificationPrompts: false });
    expect((await request(app).get('/api/credits/summary').set(token)).status).toBe(200);

    env.demoMode = false; // same token, no new sign-in
    const blocked = await request(app).get('/api/credits/summary').set(token);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('VERIFICATION_REQUIRED');
    // They can still reach what they need to verify.
    expect((await request(app).get('/api/students/me').set(token)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(token)).body.admission).toMatchObject({ admitted: false, verificationRequired: true, showVerificationPrompts: true });
    // Invited members are unaffected.
    expect((await request(app).get('/api/credits/summary').set(auth(ids.ben))).status).toBe(200);
  });

  it('records demo admission separately and never sets a verified flag', async () => {
    await run(ids.cat, T0, (tx, ctx) => recordDemoAdmission(tx, ctx, ids.cat, 'student registration'));
    await run(ids.cat, T0, (tx, ctx) => recordDemoAdmission(tx, ctx, ids.cat, 'again')); // idempotent
    const m = await prisma.member.findUniqueOrThrow({ where: { id: ids.cat } });
    expect(m).toMatchObject({ demoAdmissionReason: 'student registration', studentEmailVerifiedAt: null, contactEmailVerifiedAt: null });
    const me = await request(app).get('/api/auth/me').set(auth(ids.cat));
    expect(me.body.member).toMatchObject({ universityEmailVerified: false, demoBadge: 'Demo student' });
    expect(await prisma.auditEvent.count({ where: { action: 'member.demo_admitted', entityId: ids.cat } })).toBe(1);
  });
});
