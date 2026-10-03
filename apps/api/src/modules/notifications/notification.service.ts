import type { EmailOutbox, Member, Notification } from '@prisma/client';
import { NOTIFICATION_CATEGORIES, type EmailOutboxView, type NotificationCategory, type NotificationPreferences, type NotificationView } from '@commonhours/shared';
import { env } from '../../config/env';
import { prisma, type Db } from '../../core/db';
import { AppError, notFound } from '../../core/errors';
import { deliveryMode, deliveryNote, emailProvider } from './email.provider';
import { CATEGORY_LABELS, type NotificationIntent } from './notification.events';

const MODULE = 'notifications';
const MAX_ATTEMPTS = 5;
/** Wall-clock retry backoff for real delivery: 1 min, 5 min, 30 min, 2 h. */
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000];
/** Categories whose email never includes the in-app body (evidence, claims and votes stay in the app). */
const TITLE_ONLY: NotificationCategory[] = ['disputes', 'jury'];

/** The address notifications go to: the contact email, else the login email. */
export function notificationAddress(m: Pick<Member, 'contactEmail' | 'email'>) {
  return m.contactEmail ?? m.email;
}

export function addressVerified(m: Pick<Member, 'contactEmailVerifiedAt'>) {
  return !!m.contactEmailVerifiedAt;
}

function emailText(n: Pick<Notification, 'title' | 'body' | 'link' | 'category'>) {
  const lines = [n.title, ''];
  if (!TITLE_ONLY.includes(n.category as NotificationCategory)) lines.push(n.body, '');
  else lines.push('Details are only shown inside CommonHours.', '');
  if (n.link) lines.push(`Open: ${env.appBaseUrl}${n.link}`, '');
  lines.push('You receive this because you turned on email notifications. Change this in CommonHours → Account → Notifications.');
  return lines.join('\n');
}

/**
 * Writes notifications (deduplicated by key) and, for opted-in members with a verified address,
 * an email outbox row. Called after the business transaction commits.
 */
export async function createNotifications(intents: NotificationIntent[]) {
  const created = await prisma.notification.createManyAndReturn({
    data: intents.map((i) => ({
      memberId: i.memberId,
      kind: i.kind,
      category: i.category,
      title: i.title.slice(0, 200),
      body: i.body.slice(0, 1000),
      link: i.link ?? null,
      entityType: i.entityType ?? null,
      entityId: i.entityId ?? null,
      dedupeKey: i.dedupeKey,
      createdAt: i.at,
    })),
    skipDuplicates: true,
  });
  if (!created.length) return created;
  const members = new Map((await prisma.member.findMany({ where: { id: { in: [...new Set(created.map((n) => n.memberId))] } } })).map((m) => [m.id, m]));
  const mode = deliveryMode();
  const outbox = created.flatMap((n) => {
    const m = members.get(n.memberId);
    if (!m?.emailNotifications) return [];
    if (m.emailCategories.length && !m.emailCategories.includes(n.category)) return [];
    if (!addressVerified(m)) return [];
    return [emailRow(n.memberId, notificationAddress(m), `CommonHours: ${n.title}`, emailText(n), `email:${n.dedupeKey}`, mode, n.id)];
  });
  if (outbox.length) {
    await prisma.emailOutbox.createMany({ data: outbox, skipDuplicates: true });
    scheduleDelivery();
  }
  return created;
}

function emailRow(memberId: string, to: string, subject: string, body: string, dedupeKey: string, mode = deliveryMode(), notificationId?: string) {
  return {
    notificationId: notificationId ?? null,
    memberId,
    toAddress: to,
    subject: subject.slice(0, 200),
    body,
    dedupeKey,
    status: mode === 'smtp' ? ('PENDING' as const) : mode === 'preview' ? ('PREVIEW' as const) : ('SKIPPED' as const),
    provider: mode === 'smtp' ? 'configured' : mode,
    lastError: mode === 'disabled' ? 'Email delivery is not configured on this server.' : null,
    nextAttemptAt: new Date(),
  };
}

/** Transactional email (e.g. a verification code). Ignores notification preferences. */
export async function enqueueTransactionalEmail(memberId: string, to: string, subject: string, body: string, dedupeKey: string) {
  const row = await prisma.emailOutbox.create({ data: emailRow(memberId, to, subject, body, dedupeKey) });
  scheduleDelivery();
  return row;
}

let deliveryScheduled = false;
function scheduleDelivery() {
  // Tests call deliverOutbox() explicitly so runs stay deterministic.
  if (env.isTest || deliveryMode() !== 'smtp' || deliveryScheduled) return;
  deliveryScheduled = true;
  setImmediate(() => {
    deliveryScheduled = false;
    void deliverOutbox().catch((e) => console.error('[email] delivery run failed:', e));
  });
}

/**
 * Sends due PENDING emails. Each row is claimed with a conditional update (PENDING → SENDING), so
 * concurrent runs never send the same email twice. Failures retry with backoff, then become FAILED.
 */
export async function deliverOutbox(limit = 25) {
  if (deliveryMode() !== 'smtp') return { sent: 0, failed: 0, retrying: 0 };
  const due = await prisma.emailOutbox.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: limit });
  const result = { sent: 0, failed: 0, retrying: 0 };
  for (const row of due) {
    const claim = await prisma.emailOutbox.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'SENDING' } });
    if (claim.count !== 1) continue;
    try {
      const provider = await emailProvider();
      await provider.send({ to: row.toAddress, subject: row.subject, text: row.body });
      await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, provider: provider.name, lastError: null } });
      result.sent++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: final ? 'FAILED' : 'PENDING',
          attempts,
          lastError: (e as Error).message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
        },
      });
      if (final) result.failed++;
      else result.retrying++;
    }
  }
  return result;
}

/** Rows stuck in SENDING (process died mid-send) go back to PENDING after 10 minutes. */
export async function recoverStuckEmails() {
  return prisma.emailOutbox.updateMany({ where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - 600_000) } }, data: { status: 'PENDING' } });
}

export function toNotificationView(n: Notification & { email?: EmailOutbox | null }): NotificationView {
  return {
    id: n.id,
    kind: n.kind,
    category: n.category as NotificationCategory,
    title: n.title,
    body: n.body,
    link: n.link,
    entityType: n.entityType,
    entityId: n.entityId,
    read: !!n.readAt,
    createdAt: n.createdAt.toISOString(),
    email: n.email ? { status: n.email.status, provider: n.email.provider } : null,
  };
}

export async function listNotifications(db: Db, memberId: string, opts: { limit?: number; unreadOnly?: boolean } = {}) {
  const [rows, unread] = await Promise.all([
    db.notification.findMany({
      where: { memberId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      include: { email: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit ?? 50,
    }),
    db.notification.count({ where: { memberId, readAt: null } }),
  ]);
  return { notifications: rows.map(toNotificationView), unread };
}

export async function markRead(memberId: string, id: string, now: Date) {
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n || n.memberId !== memberId) throw notFound(MODULE, 'Notification');
  if (!n.readAt) await prisma.notification.update({ where: { id }, data: { readAt: now } });
}

export async function markAllRead(memberId: string, now: Date) {
  const r = await prisma.notification.updateMany({ where: { memberId, readAt: null }, data: { readAt: now } });
  return r.count;
}

export async function preferencesOf(db: Db, memberId: string): Promise<NotificationPreferences> {
  const m = await db.member.findUnique({ where: { id: memberId } });
  if (!m) throw notFound(MODULE, 'Member');
  const mode = deliveryMode();
  return {
    emailEnabled: m.emailNotifications,
    categories: (m.emailCategories.length ? m.emailCategories : [...NOTIFICATION_CATEGORIES]) as NotificationCategory[],
    allCategories: NOTIFICATION_CATEGORIES.map((key) => ({ key, label: CATEGORY_LABELS[key] })),
    address: notificationAddress(m),
    addressVerified: addressVerified(m),
    delivery: { mode, note: deliveryNote(mode) },
  };
}

export async function updatePreferences(memberId: string, emailEnabled: boolean, categories: NotificationCategory[]) {
  const m = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (emailEnabled && !addressVerified(m)) {
    throw new AppError('VERIFICATION_FAILED', `Verify ${notificationAddress(m)} first (Profile → Contact verification). Emails are only sent to a verified address.`, MODULE);
  }
  await prisma.member.update({ where: { id: memberId }, data: { emailNotifications: emailEnabled, emailCategories: categories } });
}

export function toOutboxView(r: EmailOutbox): EmailOutboxView {
  return {
    id: r.id,
    toAddress: r.toAddress,
    subject: r.subject,
    body: r.body,
    status: r.status,
    provider: r.provider,
    attempts: r.attempts,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
  };
}

export async function outboxFor(db: Db, memberId: string, limit = 30) {
  const rows = await db.emailOutbox.findMany({ where: { memberId }, orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map(toOutboxView);
}
