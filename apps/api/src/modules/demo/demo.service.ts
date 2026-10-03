import type { DemoGuideStep } from '@commonhours/shared';
import { RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { addDays } from '../../core/dates';
import { prisma, type Tx } from '../../core/db';
import { recordAudit } from '../audit/audit.service';
import { sweepVoteDeadlines } from '../attestation/attestation.service';
import { refreshCredibility } from '../credibility/credibility.service';
import { sweepReminders } from '../notifications/notification.reminders';
import { runCreditExpiry } from '../expiry/expiry.service';
import { expireStaleVouches } from '../vouches/vouch.service';
import { DEMO_NOW, seedDemo } from './demo.seed';

export async function resetDemo() {
  await seedDemo(prisma);
}

/**
 * Advances the simulated clock and runs every time-based sweep with real backend rules:
 * vouch expiry, credit expiry, attestation deadlines, and score refresh (vouch decay).
 */
export async function advanceClock(tx: Tx, ctx: Ctx, days: number) {
  const before = ctx.now;
  const after = addDays(before, days);
  await tx.systemState.upsert({ where: { id: 1 }, create: { id: 1, simulatedNow: after }, update: { simulatedNow: after } });
  const c2 = { ...ctx, now: after };
  await recordAudit(tx, c2, {
    module: 'demo',
    action: 'clock.advanced',
    entityType: 'SYSTEM',
    entityId: 'clock',
    before: { now: before },
    after: { now: after },
    reason: `Simulated clock advanced by ${days} day(s) from the demo panel.`,
    ruleId: RULES.DEMO,
    summary: `Simulated clock advanced ${days} day(s) to ${after.toISOString().slice(0, 16).replace('T', ' ')}`,
  });
  const vouches = await expireStaleVouches(tx, c2);
  const credits = await runCreditExpiry(tx, c2);
  const disputes = await sweepVoteDeadlines(tx, c2);
  const ids = (await tx.member.findMany({ select: { id: true } })).map((m) => m.id);
  await refreshCredibility(tx, c2, ids, `clock advanced ${days} day(s)`);
  const reminders = await sweepReminders(tx, c2);
  return { now: after, expiredVouches: vouches, expiredCredits: credits, disputesNeedingReview: disputes, reminders };
}

export async function runSweeps(tx: Tx, ctx: Ctx) {
  const vouches = await expireStaleVouches(tx, ctx);
  const credits = await runCreditExpiry(tx, ctx);
  const disputes = await sweepVoteDeadlines(tx, ctx);
  const reminders = await sweepReminders(tx, ctx);
  return { expiredVouches: vouches, expiredCredits: credits, disputesNeedingReview: disputes, reminders };
}

/** Next-step guide computed from database state (not from UI clicks). */
export async function demoGuide(now: Date): Promise<DemoGuideStep[]> {
  const members = await prisma.member.findMany();
  const by = (h: string) => members.find((m) => m.handle === h);
  const mei = by('mei');
  const sam = by('sam');
  if (!mei || !sam) return [];
  const pair = await prisma.exchange.findMany({
    where: { OR: [{ providerId: mei.id, recipientId: sam.id }, { providerId: sam.id, recipientId: mei.id }] },
    include: { dispute: { include: { assignments: { include: { attestor: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  const cooking = pair.find((e) => e.providerId === sam.id && e.category === 'Cooking');
  const tutoring = pair.find((e) => e.providerId === mei.id && e.category === 'Tutoring');
  const third = pair.find((e) => e.id !== cooking?.id && e.id !== tutoring?.id);
  const accepted = (e?: { status: string }) => !!e && ['ACCEPTED', 'DISPUTED', 'SETTLED', 'RELEASED'].includes(e.status);
  const dispute = third?.dispute;
  const pending = dispute?.assignments.filter((a) => a.status === 'ASSIGNED').map((a) => a.attestor.displayName) ?? [];
  const meiInvited = (await prisma.invitation.count({ where: { inviterId: mei.id } })) > 0;
  const due = (e?: { scheduledAt: Date }) => !!e && e.scheduledAt <= now;
  const steps: Omit<DemoGuideStep, 'n'>[] = [
    { title: 'Mei finds Sam’s cooking offer', done: !!cooking, actAs: 'mei', where: 'Service Board', instruction: 'Switch to Mei. On the Service Board, filter Cooking + "reachable only" and open “Home-cooked Malaysian dinner”.' },
    { title: 'Show the trust path Mei → Sam', done: !!cooking, actAs: 'mei', where: 'Trust Network', instruction: 'Select Mei then Sam in the graph (or use the path finder). Path Mei → Alice → Ben → Sam: 0.7 × 1.0 × 0.7 = 0.49 connection strength.' },
    { title: 'Inspect vouches and liability terms', done: !!cooking, actAs: 'mei', where: 'Trust Network → click an edge', instruction: 'Click the Alice→Mei edge: strength, age, status, liability % and the maximum penalty Alice accepted.' },
    { title: 'Agree two separate services', done: accepted(cooking) && accepted(tutoring), actAs: cooking && !accepted(cooking) ? 'sam' : 'mei', where: 'Service Board → Propose', instruction: 'As Mei: request 2h cooking from Sam’s offer. Then from that exchange, “Propose reciprocal exchange”: 1h tutoring by Mei for Sam. Switch to Sam and accept both (each has its own terms).' },
    { title: 'Show reservations and available balances', done: accepted(cooking) && accepted(tutoring) && (cooking!.status === 'SETTLED' || tutoring!.status === 'SETTLED'), actAs: 'mei', where: 'Time Credits', instruction: 'Mei: 2 credits reserved (available = posted − 2). Sam: 1 reserved. Pending incoming shows what each will receive.' },
    { title: 'Both confirm → settlement and net change', done: cooking?.status === 'SETTLED' && tutoring?.status === 'SETTLED', actAs: 'sam', where: 'My Exchanges', instruction: `${due(cooking) ? '' : 'Advance the simulated clock past the scheduled time first (+1d) — services must have happened. '}Both members confirm both exchanges. Net: Mei −1, Sam +1 — two settlements, 1h and 2h, never treated as equal.` },
    { title: 'Start a separate, unsettled exchange', done: accepted(third), actAs: third && !accepted(third) ? 'mei' : 'sam', where: 'Service Board', instruction: 'As Sam, request Mei’s “Mandarin ↔ English translation” offer (1h) and tick “Punctuality is a required condition”. Switch to Mei and accept. This is a NEW exchange — settled credits are never frozen.' },
    { title: 'Sam disputes the agreed punctuality condition', done: !!dispute, actAs: 'sam', where: 'Exchange page → Dispute', instruction: `${third && !due(third) ? 'Advance the simulated clock past the scheduled time (+1d). ' : ''}As Sam, open a dispute with condition “Punctuality”. (It is only allowed because punctuality was agreed.)` },
    { title: 'Show frozen credits and eligible attestors', done: !!dispute && dispute.status !== 'AWAITING_ATTESTATION', actAs: 'sam', where: 'Disputes', instruction: 'Credits are FROZEN (still reserved, not paid). The eligibility table shows who was excluded and why, and the recorded seed.' },
    { title: 'Attestors vote → resolution', done: dispute?.status === 'RESOLVED', actAs: pending[0]?.toLowerCase().split(' ')[0] ?? null, where: 'Disputes → Vote', instruction: pending.length ? `Switch to ${pending.join(' / ')} and vote with a reason. Tip: first attestor votes “Unclear” to escalate to a panel of three; two matching votes decide.` : 'Votes complete or not started yet.' },
    { title: 'Ledger, credibility and audit changes', done: dispute?.status === 'RESOLVED', actAs: 'mei', where: 'Time Credits / My Credibility / Activity', instruction: 'See the settlement or release, the credibility history entries and the audit trail with rule ids.' },
    { title: 'Mei becomes eligible to invite', done: meiInvited, actAs: 'mei', where: 'My Credibility → Trust Network → Invite', instruction: 'Mei’s score is computed from records. Once ≥ 40 the “Invite new members” permission unlocks; create an invitation.' },
  ];
  return steps.map((s, i) => ({ n: i + 1, ...s }));
}

export const DEMO_EXTRAS = [
  { title: 'Credit floor case', instruction: 'Switch to Ben and open the proposed washing-machine repair from Kofi (3h). Accepting would take Ben’s available balance below −5, so the backend blocks it and explains why.' },
  { title: 'Insufficient attestors case', instruction: 'Open the Kofi–Lena kettle dispute: after the first attestor voted “unclear”, too few eligible members remain for a panel of three, so it is in NEEDS_REVIEW with frozen credits and a next action.' },
  { title: 'Expiry', instruction: 'Tomás’s oldest earned credits already expired at seed time (see his Time Credits). Advance the clock to watch his next lot expire.' },
];

export { DEMO_NOW };
