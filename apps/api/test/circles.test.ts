import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeStudentEmail, type UniversityCode } from '@commonhours/shared';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/core/db';
import { signToken } from '../src/modules/auth/auth.service';
import { planCircleMembership } from '../src/modules/circles/circles.rules';
import { computeCredibility } from '../src/modules/credibility/credibility.service';
import { setEmailProviderForTests } from '../src/modules/notifications/email.provider';
import { createListing } from '../src/modules/services/listing.service';
import { requestStudentEmailCode } from '../src/modules/student/student.verification';
import { T0, community, reset, run } from './fixtures';

const app = createApp();
const auth = (id: string) => ({ authorization: `Bearer ${signToken(id)}` });
const details = (university: UniversityCode, local: string) => ({ university, studentEmail: composeStudentEmail(university, local), currentStudentDeclaration: true });

async function joinStudent(handle: string, university: UniversityCode = 'HKU') {
  const r = await request(app)
    .post('/api/auth/join/student')
    .send({ displayName: handle, handle, password: 'student-password', acceptCommunityTerms: true, student: details(university, handle) });
  expect(r.status).toBe(201);
  return r.body.member.id as string;
}

afterEach(() => {
  env.demoMode = true;
  setEmailProviderForTests(null);
});

describe('circle membership planning (pure)', () => {
  const demo = { university: 'HKU', allowed: true, via: 'DEMO_SELF_DECLARED' as const, reason: '' };
  it('joins, keeps, switches and removes', () => {
    expect(planCircleMembership([], demo)).toEqual({ close: [], open: { university: 'HKU', via: 'DEMO_SELF_DECLARED' }, updateVia: null });
    expect(planCircleMembership([{ id: 'a', university: 'HKU', via: 'DEMO_SELF_DECLARED' }], demo)).toEqual({ close: [], open: null, updateVia: null });
    const sw = planCircleMembership([{ id: 'a', university: 'HKU', via: 'DEMO_SELF_DECLARED' }], { ...demo, university: 'CUHK' });
    expect(sw.close).toEqual([{ id: 'a', reason: 'University changed to CUHK.' }]);
    expect(sw.open).toEqual({ university: 'CUHK', via: 'DEMO_SELF_DECLARED' });
    const lost = planCircleMembership([{ id: 'a', university: 'HKU', via: 'DEMO_SELF_DECLARED' }], { university: 'HKU', allowed: false, via: null, reason: 'Verify first.' });
    expect(lost).toEqual({ close: [{ id: 'a', reason: 'Verify first.' }], open: null, updateVia: null });
    expect(planCircleMembership([{ id: 'a', university: 'HKU', via: 'DEMO_SELF_DECLARED' }], { ...demo, via: 'VERIFIED_EMAIL' }).updateVia).toEqual({ id: 'a', via: 'VERIFIED_EMAIL' });
  });
});

describe('university circles', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await reset();
    ids = await community(['alice', 'ben', 'cat']);
  });

  it('demo mode: a student is in their university circle right after registration and can only use that room', async () => {
    const hana = await joinStudent('hana');
    const m = await prisma.circleMembership.findFirstOrThrow({ where: { memberId: hana, leftAt: null }, include: { room: true } });
    expect(m).toMatchObject({ via: 'DEMO_SELF_DECLARED', room: { universityCode: 'HKU', name: 'HKU Circle' } });

    const posted = await request(app).post('/api/circles/HKU/messages').set(auth(hana)).send({ body: 'Anyone up for a coding session?', tags: ['Coding'] });
    expect(posted.status).toBe(201);
    const room = await request(app).get('/api/circles/HKU/messages').set(auth(hana));
    expect(room.body.messages.map((x: { body: string }) => x.body)).toEqual(['Anyone up for a coding session?']);
    expect((await request(app).get('/api/circles/HKU/messages?tag=Tutoring').set(auth(hana))).body.messages).toHaveLength(0);

    // Not entitled: another university's room, or members without a university.
    expect((await request(app).get('/api/circles/CUHK/messages').set(auth(hana))).status).toBe(403);
    expect((await request(app).post('/api/circles/HKU/messages').set(auth(ids.ben)).send({ body: 'hi' })).body.error.code).toBe('CIRCLE_ACCESS_DENIED');
  });

  it('circle membership creates no friendships, vouches, credibility or relationship strength', async () => {
    const hana = await joinStudent('hana');
    const ivy = await joinStudent('ivy');
    await request(app).post('/api/circles/HKU/messages').set(auth(hana)).send({ body: 'hello' });
    expect(await prisma.vouch.count({ where: { OR: [{ voucheeId: { in: [hana, ivy] } }, { voucherId: { in: [hana, ivy] } }] } })).toBe(0);
    expect(await prisma.earnedRelationship.count()).toBe(0);
    expect((await computeCredibility(prisma, hana, T0)).score).toBe((await computeCredibility(prisma, ivy, T0)).score);
    expect((await computeCredibility(prisma, hana, T0)).score).toBe(0);
  });

  it('switching university keeps history but moves access to the new circle', async () => {
    const hana = await joinStudent('hana');
    await request(app).post('/api/circles/HKU/messages').set(auth(hana)).send({ body: 'my HKU message' });
    const put = await request(app).put('/api/students/me').set(auth(hana)).send(details('CUHK', 'hana'));
    expect(put.status).toBe(200);
    expect((await request(app).get('/api/circles/HKU/messages').set(auth(hana))).status).toBe(403);
    expect((await request(app).get('/api/circles/CUHK/messages').set(auth(hana))).status).toBe(200);
    expect(await prisma.circleMessage.count({ where: { body: 'my HKU message' } })).toBe(1); // history kept
    const me = await request(app).get('/api/circles/me').set(auth(hana));
    expect(me.body).toMatchObject({ circle: { code: 'CUHK', name: 'CUHK Circle' }, allowed: true, via: 'DEMO_SELF_DECLARED' });
    expect(me.body.formerCircles[0]).toMatchObject({ code: 'HKU', leftReason: 'University changed to CUHK.' });
  });

  it('invited members add university details and join through the same demo flow', async () => {
    const put = await request(app).put('/api/students/me').set(auth(ids.cat)).send(details('PolyU', 'cat'));
    expect(put.status).toBe(200);
    expect((await request(app).get('/api/circles/PolyU/messages').set(auth(ids.cat))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(auth(ids.cat))).body.member.demoBadge).toBe('Demo student');
  });

  it('normal mode: a profile university alone grants nothing; genuine verification does; stale demo membership is removed', async () => {
    const hana = await joinStudent('hana'); // student route, joined in demo mode
    await request(app).put('/api/students/me').set(auth(ids.cat)).send(details('HKU', 'cat')); // invited member, demo affiliation
    expect(await prisma.circleMembership.count({ where: { memberId: ids.cat, leftAt: null } })).toBe(1);
    env.demoMode = false;
    // Existing room membership and existing sessions cannot preserve the bypass.
    expect((await request(app).get('/api/circles/HKU/messages').set(auth(hana))).body.error.code).toBe('VERIFICATION_REQUIRED');
    expect((await request(app).get('/api/circles/HKU/messages').set(auth(ids.cat))).body.error.code).toBe('CIRCLE_ACCESS_DENIED');
    // The membership record is closed on the next sync; the reason is shown.
    const me = await request(app).get('/api/circles/me').set(auth(ids.cat));
    expect(me.body).toMatchObject({ allowed: false, via: null, reason: 'Verify your HKU email to join the HKU Circle.' });
    expect(await prisma.circleMembership.count({ where: { memberId: ids.cat, leftAt: null } })).toBe(0);

    // Genuine verification (code delivered by a real provider) grants access again.
    setEmailProviderForTests({ name: 'fake', send: async () => ({ messageId: 'x' }) });
    const sent = await run(ids.cat, T0, (tx, ctx) => requestStudentEmailCode(tx, ctx, ids.cat));
    const confirmed = await request(app).post('/api/students/me/verify/confirm').set(auth(ids.cat)).send({ code: sent.code });
    expect(confirmed.status).toBe(200);
    expect((await request(app).get('/api/circles/HKU/messages').set(auth(ids.cat))).status).toBe(200);
    expect(await prisma.circleMembership.findFirst({ where: { memberId: ids.cat, leftAt: null } })).toMatchObject({ via: 'VERIFIED_EMAIL' });
  });

  it('members who left cannot use circles; the board lists circle requests and offers by tag', async () => {
    const hana = await joinStudent('hana');
    const ivy = await joinStudent('ivy');
    await run(ivy, T0, (tx, ctx) =>
      createListing(tx, ctx, ivy, { type: 'REQUEST', title: 'Help me move boxes', description: 'Two boxes to the MTR.', category: 'Other', durationMinutes: 60, locationType: 'IN_PERSON', location: 'Pok Fu Lam', availability: 'Saturday', requiredSkills: [], tags: ['Moving and practical help'] }),
    );
    await run(ids.alice, T0, (tx, ctx) =>
      createListing(tx, ctx, ids.alice, { type: 'OFFER', title: 'Not in the circle', description: 'Alice is not an HKU member.', category: 'Other', durationMinutes: 60, locationType: 'ONLINE', location: '', availability: 'Any', requiredSkills: [], tags: ['Moving and practical help'] }),
    );
    const board = await request(app).get('/api/circles/HKU/board?tag=Moving%20and%20practical%20help').set(auth(hana));
    expect(board.body.listings.map((l: { title: string; tags: string[] }) => [l.title, l.tags])).toEqual([['Help me move boxes', ['Moving and practical help']]]);
    expect((await request(app).get('/api/circles/HKU/board?tag=Coding').set(auth(hana))).body.listings).toHaveLength(0);
    expect((await request(app).get('/api/listings?tag=Moving%20and%20practical%20help').set(auth(hana))).body.listings).toHaveLength(2);

    await prisma.member.update({ where: { id: ivy }, data: { status: 'LEFT' } });
    expect((await request(app).get('/api/circles/HKU/messages').set(auth(ivy))).status).toBe(403);
  });
});
