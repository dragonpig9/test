import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { addDays, addHours } from '../src/core/dates';
import { prisma, withTx } from '../src/core/db';
import { openDispute } from '../src/modules/attestation/attestation.service';
import { confirmCompletion } from '../src/modules/exchanges/exchange.service';
import { setEmailProviderForTests, type EmailMessage } from '../src/modules/notifications/email.provider';
import { notify } from '../src/modules/notifications/notification.events';
import { createNotifications, deliverOutbox, listNotifications, markAllRead, updatePreferences } from '../src/modules/notifications/notification.service';
import { homeAddressFor, profileView, updateProfile } from '../src/modules/profiles/profile.service';
import { confirmEmailVerification, requestEmailVerification } from '../src/modules/profiles/profile.verification';
import { T0, agreed, community, reset, run, settleBoth } from './fixtures';

let ids: Record<string, string>;
const at = addDays(T0, 2);
const profileInput = (over: object = {}) => ({
  displayName: 'Bea',
  intro: 'Hi',
  affiliation: 'City University',
  neighborhood: 'North side',
  languages: ['English'],
  skills: ['Cooking'],
  availability: 'Evenings',
  shareContactWithPartners: false,
  juryAvailable: true,
  ...over,
});
const verify = async (h: string, when = T0) => {
  const r = await run(ids[h], when, (tx, ctx) => requestEmailVerification(tx, ctx, ids[h]));
  return run(ids[h], when, (tx, ctx) => confirmEmailVerification(tx, ctx, ids[h], r.code));
};

/** One confirmed service provided → 0.7 vouch 14 + on-time rate 15 + 4 = 33 (enough for restricted tasks). */
const history = async (h: string) => {
  const ex = await agreed(ids[h], ids.a, 60, addDays(T0, -20));
  await settleBoth(ex.id, ids[h], ids.a, addHours(addDays(T0, -20), 2));
};

beforeEach(async () => {
  await reset();
  ids = await community(['a', 'b', 'c', 'd']);
});
afterEach(() => {
  setEmailProviderForTests(null);
  env.demoMode = true;
});

describe('profiles: privacy and verification labels', () => {
  it('keeps email, phone and address private by default and never shows "verified" without a verification', async () => {
    await run(ids.b, T0, (tx, ctx) => updateProfile(tx, ctx, ids.b, profileInput({ contactEmail: 'bea@gmail.com', phone: '+44 7700 900123', homeAddress: '1 Secret Road' })));
    const other = await profileView(prisma, ids.b, ids.c, T0);
    expect(other.contact).toBeNull();
    expect(other.private).toBeNull();
    expect(other.verification.email.status).toBe('UNVERIFIED');
    expect(other.verification.phone.status).toBe('UNAVAILABLE');
    expect(other.selfReported).toMatchObject({ affiliation: 'City University', neighborhood: 'North side' });
    expect(JSON.stringify(other)).not.toMatch(/bea@gmail|7700|Secret Road/);
    const mine = await profileView(prisma, ids.b, ids.b, T0);
    expect(mine.contact).toMatchObject({ email: 'bea@gmail.com', phone: '+44 7700 900123' });
    expect(mine.private).toMatchObject({ homeAddress: '1 Secret Road' });
    // Members list (v1 endpoint) never exposes contact fields either.
    const app = createApp();
    const { body } = await request(app).post('/api/demo/switch').send({ handle: 'c' });
    const list = await request(app).get('/api/members').set('authorization', `Bearer ${body.token}`);
    expect(JSON.stringify(list.body)).not.toMatch(/bea@gmail|7700|Secret Road|passwordHash/);
    // The audit trail records field names, not the values.
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'profile.updated', entityId: ids.b } });
    expect(JSON.stringify(audit)).not.toMatch(/bea@gmail|7700|Secret Road/);
  });

  it('labels demo-preview verification honestly and resets verification when the address changes', async () => {
    await run(ids.b, T0, (tx, ctx) => updateProfile(tx, ctx, ids.b, profileInput({ contactEmail: 'bea@gmail.com' })));
    expect((await verify('b')).method).toBe('demo-preview');
    let p = await profileView(prisma, ids.b, ids.c, T0);
    expect(p.verification.email.status).toBe('DEMO_VERIFIED');
    expect(p.member.contactVerification).toBe('DEMO_VERIFIED');
    // With a configured provider the code is really delivered → VERIFIED.
    const sent: EmailMessage[] = [];
    setEmailProviderForTests({ name: 'test', send: async (m) => (sent.push(m), { messageId: String(sent.length) }) });
    await run(ids.b, T0, (tx, ctx) => updateProfile(tx, ctx, ids.b, profileInput({ contactEmail: 'bea.new@gmail.com' })));
    expect((await profileView(prisma, ids.b, ids.c, T0)).verification.email.status).toBe('UNVERIFIED');
    const r = await run(ids.b, T0, (tx, ctx) => requestEmailVerification(tx, ctx, ids.b));
    await deliverOutbox();
    expect(sent[0]).toMatchObject({ to: 'bea.new@gmail.com' });
    expect(sent[0].text).toContain(r.code);
    await run(ids.b, T0, (tx, ctx) => confirmEmailVerification(tx, ctx, ids.b, r.code));
    p = await profileView(prisma, ids.b, ids.c, T0);
    expect(p.verification.email.status).toBe('VERIFIED');
    // Wrong codes are rejected and counted.
    const again = await run(ids.b, T0, (tx, ctx) => requestEmailVerification(tx, ctx, ids.b));
    const wrong = again.code === '000000' ? '111111' : '000000';
    expect(await run(ids.b, T0, (tx, ctx) => confirmEmailVerification(tx, ctx, ids.b, wrong))).toMatchObject({ verified: false });
  });

  it('shows contact details to active exchange partners only when shared, and the address only to the provider of an accepted in-home task', async () => {
    await run(ids.b, T0, (tx, ctx) => updateProfile(tx, ctx, ids.b, profileInput({ contactEmail: 'bea@gmail.com', homeAddress: '1 Secret Road', shareContactWithPartners: true })));
    expect((await profileView(prisma, ids.b, ids.c, T0)).contact).toBeNull(); // no active exchange yet
    await history('c');
    const ex = await agreed(ids.c, ids.b, 60, at, { trustTier: 'STANDARD' });
    expect((await profileView(prisma, ids.b, ids.c, T0)).contact).toMatchObject({ email: 'bea@gmail.com' });
    const row = await prisma.exchange.findUniqueOrThrow({ where: { id: ex.id } });
    expect(await homeAddressFor(prisma, row, ids.c)).toBeNull(); // not an in-home task
    const inHome = await agreed(ids.c, ids.b, 60, addDays(at, 1), { trustTier: 'RESTRICTED' });
    const inHomeRow = await prisma.exchange.findUniqueOrThrow({ where: { id: inHome.id } });
    expect(await homeAddressFor(prisma, inHomeRow, ids.c)).toBe('1 Secret Road');
    expect(await homeAddressFor(prisma, inHomeRow, ids.d)).toBeNull();
    await settleBoth(inHome.id, ids.c, ids.b, addHours(addDays(at, 1), 2));
    expect(await homeAddressFor(prisma, await prisma.exchange.findUniqueOrThrow({ where: { id: inHome.id } }), ids.c)).toBeNull();
  });
});

describe('notifications and email', () => {
  it('persists notifications after commit, deduplicates them, and supports read / read-all', async () => {
    const ex = await agreed(ids.c, ids.b, 60, at);
    await settleBoth(ex.id, ids.c, ids.b, addHours(at, 2));
    // A retried confirmation is rejected and creates no second notification.
    await expect(run(ids.b, addHours(at, 3), (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids.b))).rejects.toMatchObject({ code: 'ALREADY_DONE' });
    const kinds = (await prisma.notification.findMany({ where: { memberId: ids.c, entityId: ex.id } })).map((n) => n.kind).sort();
    // c (provider) was proposed to, saw the acceptance, was paid and gained earned trust — each exactly once.
    expect(kinds).toEqual(['credits.settled', 'exchange.accepted', 'exchange.proposed', 'trust.changed']);
    // Same dedupe key twice → one row.
    const intent = { memberId: ids.b, kind: 'test', category: 'credits' as const, title: 'x', body: 'y', dedupeKey: 'test:once', at: T0 };
    await createNotifications([intent]);
    await createNotifications([intent]);
    expect(await prisma.notification.count({ where: { dedupeKey: 'test:once' } })).toBe(1);
    // Persisted: a fresh read (as after a page refresh) returns them; read-all clears the badge.
    const list = await listNotifications(prisma, ids.b);
    expect(list.unread).toBeGreaterThan(0);
    await markAllRead(ids.b, T0);
    expect((await listNotifications(prisma, ids.b)).unread).toBe(0);
  });

  it('never notifies for a rolled-back transaction', async () => {
    await expect(
      withTx(async () => {
        notify({ memberId: ids.b, kind: 'test', category: 'credits', title: 'x', body: 'y', dedupeKey: 'rollback:1', at: T0 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.notification.count({ where: { dedupeKey: 'rollback:1' } })).toBe(0);
  });

  it('missing email configuration does not break anything (demo preview / skipped outside demo)', async () => {
    await verify('b');
    await updatePreferences(ids.b, true, []);
    const ex = await agreed(ids.c, ids.b, 60, at);
    await settleBoth(ex.id, ids.c, ids.b, addHours(at, 2));
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe('SETTLED');
    const outbox = await prisma.emailOutbox.findMany({ where: { memberId: ids.b, notificationId: { not: null } } });
    expect(outbox.length).toBeGreaterThan(0);
    expect(new Set(outbox.map((o) => o.status))).toEqual(new Set(['PREVIEW']));
    // Not opted in → no emails at all.
    expect(await prisma.emailOutbox.count({ where: { memberId: ids.c, notificationId: { not: null } } })).toBe(0);
    // Outside demo mode without credentials: rows are SKIPPED with a reason, exchanges still settle.
    env.demoMode = false;
    const ex2 = await agreed(ids.c, ids.b, 60, addDays(at, 1));
    await settleBoth(ex2.id, ids.c, ids.b, addHours(addDays(at, 1), 2));
    const skipped = await prisma.emailOutbox.findMany({ where: { memberId: ids.b, status: 'SKIPPED' } });
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0].lastError).toMatch(/not configured/);
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: ex2.id } })).status).toBe('SETTLED');
  });

  it('an email failure never reverses a completed exchange; it is retried from the outbox', async () => {
    await verify('b');
    await updatePreferences(ids.b, true, []);
    setEmailProviderForTests({ name: 'flaky', send: async () => Promise.reject(new Error('SMTP 421 try later')) });
    const ex = await agreed(ids.c, ids.b, 60, at);
    await settleBoth(ex.id, ids.c, ids.b, addHours(at, 2));
    const r = await deliverOutbox();
    expect(r.sent).toBe(0);
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe('SETTLED');
    const row = await prisma.emailOutbox.findFirstOrThrow({ where: { memberId: ids.b, attempts: { gt: 0 } } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'SMTP 421 try later' });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // Provider recovers: due rows are sent exactly once.
    const sent: EmailMessage[] = [];
    setEmailProviderForTests({ name: 'ok', send: async (m) => (sent.push(m), { messageId: String(sent.length) }) });
    await prisma.emailOutbox.updateMany({ where: { status: 'PENDING' }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await Promise.all([deliverOutbox(), deliverOutbox()]);
    const subjects = sent.map((m) => m.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(await prisma.emailOutbox.count({ where: { status: 'PENDING' } })).toBe(0);
  });

  it('dispute emails never contain evidence, and notification text never contains an exact address', async () => {
    await run(ids.c, T0, (tx, ctx) => updateProfile(tx, ctx, ids.c, profileInput({ displayName: 'Cy', homeAddress: '9 Hidden Lane' })));
    await verify('b');
    await updatePreferences(ids.b, true, []);
    await verify('c');
    await updatePreferences(ids.c, true, []);
    await history('b');
    const ex = await agreed(ids.b, ids.c, 60, at, { punctualityRequired: true, trustTier: 'RESTRICTED' });
    await run(ids.c, addHours(at, 2), (tx, ctx) => openDispute(tx, ctx, ids.c, { exchangeId: ex.id, condition: 'PUNCTUALITY', claim: 'SECRET-EVIDENCE: arrived 40 minutes late' }));
    const all = await prisma.emailOutbox.findMany();
    expect(all.some((e) => e.subject.includes('dispute'))).toBe(true);
    expect(JSON.stringify(all)).not.toMatch(/SECRET-EVIDENCE|9 Hidden Lane/);
    expect(JSON.stringify(await prisma.notification.findMany())).not.toMatch(/SECRET-EVIDENCE|9 Hidden Lane/);
  });
});
