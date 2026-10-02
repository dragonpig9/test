import bcrypt from 'bcryptjs';
import { makeCtx, type Ctx } from '../src/core/context';
import { addDays } from '../src/core/dates';
import { prisma, withTx, type Tx } from '../src/core/db';
import { acceptExchange, confirmCompletion, proposeExchange } from '../src/modules/exchanges/exchange.service';
import { joinWithInvitation } from '../src/modules/invitations/invitation.service';
import { ensureMemberAccount } from '../src/modules/ledger/ledger.repo';
import { truncateAll } from '../src/modules/demo/demo.seed';

export const T0 = new Date('2026-01-01T09:00:00Z');
const hash = bcrypt.hashSync('test-password', 4);

export const ctxAt = (actorId: string | null, when: Date): Ctx => makeCtx(actorId, when, `test-${Math.random().toString(36).slice(2, 10)}`);
export const run = <T>(actorId: string | null, when: Date, fn: (tx: Tx, ctx: Ctx) => Promise<T>) => withTx((tx) => fn(tx, ctxAt(actorId, when)));

export async function reset() {
  await truncateAll(prisma);
  await prisma.systemState.create({ data: { id: 1, simulatedNow: T0 } });
}

/** Builds a small community: a bootstrap member plus invited members (chain by default). */
export async function community(handles: string[], edges?: [string, string, number][]) {
  const ids: Record<string, string> = {};
  const [first, ...rest] = handles;
  const boot = await prisma.member.create({
    data: { handle: first, displayName: cap(first), email: `${first}@t.test`, passwordHash: hash, isBootstrap: true, joinedAt: addDays(T0, -60) },
  });
  ids[first] = boot.id;
  await withTx((tx) => ensureMemberAccount(tx, boot.id, boot.displayName));
  const plan = edges ?? rest.map((h, i) => [handles[i], h, 0.7] as [string, string, number]);
  let day = -50;
  for (const [inviter, h, strength] of plan) {
    const when = addDays(T0, day++);
    // Fixture shortcut: insert the invitation row directly (skips the inviter's credibility threshold
    // so larger test communities can be built). Joining still goes through the real consent path.
    const inv = await prisma.invitation.create({
      data: { code: `T-${h}`.toUpperCase(), inviterId: ids[inviter], inviteeName: cap(h), strength, liabilityPct: 25, termsVersion: 'test', createdAt: when, expiresAt: addDays(when, 14) },
    });
    const m = await run(null, when, (tx, ctx) =>
      joinWithInvitation(tx, ctx, { code: inv.code, displayName: cap(h), handle: h, email: `${h}@t.test`, password: 'test-password', acceptCommunityTerms: true, acceptVouchTerms: true }, { passwordHash: hash }),
    );
    ids[h] = m.id;
  }
  return ids;
}

/** Proposes (by recipient) and accepts (by provider) an exchange scheduled at `at`. */
export async function agreed(providerId: string, recipientId: string, minutes: number, at: Date, extra: Partial<{ punctualityRequired: boolean; giftBonus: number; category: 'Cooking' | 'Tutoring' | 'Translation' }> = {}) {
  const ex = await run(recipientId, addDays(at, -2), (tx, ctx) =>
    proposeExchange(tx, ctx, recipientId, {
      counterpartyId: providerId,
      myRole: 'recipient',
      category: extra.category ?? 'Cooking',
      deliverable: `Service of ${minutes} minutes`,
      durationMinutes: minutes,
      scheduledAt: at.toISOString(),
      location: '',
      punctualityRequired: extra.punctualityRequired ?? false,
      giftBonus: extra.giftBonus ?? 0,
      cancellationNoticeHours: 24,
      cancellationTerms: '',
      confirmationDays: 3,
    }),
  );
  await run(providerId, addDays(at, -1), (tx, ctx) => acceptExchange(tx, ctx, ex.id, providerId, ex.termsVersion));
  return ex;
}

export async function settleBoth(exchangeId: string, providerId: string, recipientId: string, when: Date) {
  await run(providerId, when, (tx, ctx) => confirmCompletion(tx, ctx, exchangeId, providerId));
  await run(recipientId, when, (tx, ctx) => confirmCompletion(tx, ctx, exchangeId, recipientId));
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
