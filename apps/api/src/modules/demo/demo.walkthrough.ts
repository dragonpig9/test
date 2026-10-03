import type { Exchange } from '@prisma/client';
import type { DemoComparisonRow, DemoParticipantView, DemoWalkthroughView, LedgerEntryView, TrustUpdateView } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import { prisma } from '../../core/db';
import { timelineFor } from '../audit/audit.repo';
import { credibilityView } from '../credibility/credibility.service';
import { getExchange, toExchangeView } from '../exchanges/exchange.repo';
import { listInvitations, toInvitationView } from '../invitations/invitation.service';
import { creditSummary, ledgerEntries } from '../ledger/ledger.service';
import { toSummary } from '../members/member.repo';
import { listNotifications, toOutboxView } from '../notifications/notification.service';
import { listSkillClaims } from '../pricing/pricing.skills';
import { discoverListings } from '../services/listing.service';
import { trustUpdateForExchange } from '../trust/trust.earned';
import { findPath, loadTrust } from '../trust/trust.service';
import { backedStrength, liabilityMultiplier } from '../vouches/vouch.rules';
import { toEdgeView } from '../vouches/vouch.view';
import { checkDemoFixtures, expiryView, floorExample, skillReviewChecks } from './demo.fixtures';
import { demoGuide, storyRecords } from './demo.service';

/** The 15 Demo Guide steps grouped into the walkthrough's five chapters (step numbers, inclusive). */
export const WALKTHROUGH_CHAPTERS = [
  { n: 1, title: 'Find help and understand trust', from: 1, to: 4 },
  { n: 2, title: 'Agree, reserve and complete', from: 5, to: 8 },
  { n: 3, title: 'Understand skill and demand pricing', from: 9, to: 9 },
  { n: 4, title: 'Resolve a dispute', from: 10, to: 12 },
  { n: 5, title: 'See the results', from: 13, to: 15 },
] as const;

/** Viewer id that matches no member, so exchange views are built from an observer's perspective. */
const OBSERVER = '';

/**
 * Read-only view for the Simple demo walkthrough. Every value comes from existing services and records;
 * nothing is computed that the full app does not already compute, and nothing is written.
 * Private data stays private: no home address, no verification codes, no evidence text.
 */
export async function demoWalkthrough(now: Date, seedVersion: string | null = null): Promise<DemoWalkthroughView | null> {
  const story = await storyRecords();
  if (!story) return null;
  const { members, by, mei, sam, cooking, tutoring, third } = story;
  const guide = await demoGuide(now);

  const exView = async (e?: Exchange | null) => (e ? toExchangeView(await getExchange(prisma, e.id), OBSERVER, now) : null);
  const [cookingView, tutoringView, translationView] = await Promise.all([exView(cooking), exView(tutoring), exView(third)]);

  // Chapter 1: listings as Mei sees them (reachability, price estimate, eligibility), the path and Alice's vouch.
  const listings = await discoverListings(prisma, mei.id, now, {});
  const find = (owner: string, pred: (l: (typeof listings)[number]) => boolean) => listings.find((l) => l.owner.id === owner && pred(l)) ?? null;
  const alice = by('alice');
  const trust = await loadTrust(prisma, now);
  const vouch = alice
    ? await prisma.vouch.findFirst({ where: { voucherId: alice.id, voucheeId: mei.id }, orderBy: { createdAt: 'desc' } })
    : null;

  // Chapters 2 and 5: credits, credibility and postings for both participants.
  const storyStart = cooking?.createdAt ?? null;
  const participant = async (m: typeof mei): Promise<DemoParticipantView & { ledger: LedgerEntryView[] }> => {
    const [credits, cred, ledger] = await Promise.all([creditSummary(prisma, m.id, now), credibilityView(prisma, m.id, now), ledgerEntries(prisma, m.id)]);
    return {
      member: toSummary(m),
      credits,
      credibility: { score: cred.score, history: cred.history, permissions: cred.permissions },
      recentLedger: storyStart ? ledger.filter((e) => new Date(e.effectiveAt) >= storyStart) : [],
      ledger,
    };
  };
  const [meiP, samP] = await Promise.all([participant(mei), participant(sam)]);

  const pairIds = [cooking?.id, tutoring?.id].filter((x): x is string => !!x);
  const settledTimes = [cooking, tutoring].filter((e) => e?.status === 'SETTLED' && e.settledAt).map((e) => e!.settledAt!.getTime());
  const firstSettledAt = settledTimes.length ? new Date(Math.min(...settledTimes)) : null;
  const lastSettledAt = settledTimes.length ? new Date(Math.max(...settledTimes)) : null;
  const scoreAt = (history: DemoParticipantView['credibility']['history'], at: Date, strict: boolean) => {
    // history is newest first; take the latest snapshot before (or at) `at`.
    const s = history.find((h) => (strict ? new Date(h.createdAt) < at : new Date(h.createdAt) <= at));
    return s?.score ?? null;
  };
  const row = (p: Awaited<ReturnType<typeof participant>>): DemoComparisonRow => {
    const firstIdx = p.ledger.findIndex((e) => e.kind === 'SETTLEMENT' && e.exchangeId && pairIds.includes(e.exchangeId));
    return {
      memberId: p.member.id,
      serviceTransfers: p.ledger
        .filter((e) => e.kind === 'SETTLEMENT' && e.exchangeId && pairIds.includes(e.exchangeId))
        .map((e) => ({ exchangeId: e.exchangeId!, deliverable: e.exchangeId === cooking?.id ? cooking.deliverable : (tutoring?.deliverable ?? ''), amount: e.amount })),
      otherPostings: firstSettledAt
        ? p.ledger
            .filter((e) => new Date(e.effectiveAt) >= firstSettledAt && !(e.exchangeId && pairIds.includes(e.exchangeId)))
            .map((e) => ({ kind: e.kind, amount: e.amount, effectiveAt: e.effectiveAt, explanation: e.explanation }))
        : [],
      postedBefore: firstIdx < 0 ? null : firstIdx === 0 ? 0 : p.ledger[firstIdx - 1].runningBalance,
      postedNow: p.credits.posted,
      reservedNow: p.credits.reservedOutgoing,
      availableNow: p.credits.available,
      credibilityBefore: firstSettledAt ? scoreAt(p.credibility.history, firstSettledAt, true) : null,
      credibilityAfter: lastSettledAt ? scoreAt(p.credibility.history, lastSettledAt, false) : null,
      credibilityNow: p.credibility.score,
      highTrustThreshold: POLICY.taskEligibility.tiers.HIGH_TRUST.minCredibility,
    };
  };

  const [cookingUpdate, tutoringUpdate] = await Promise.all([
    cooking ? trustUpdateForExchange(prisma, cooking.id) : null,
    tutoring ? trustUpdateForExchange(prisma, tutoring.id) : null,
  ]);
  const updates = [cookingUpdate, tutoringUpdate].filter((u): u is TrustUpdateView => !!u).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Compact audit trail of the story's exchanges, reservations, dispute and ledger transactions.
  const storyExchanges = [cooking, tutoring, third].filter((e): e is NonNullable<typeof e> => !!e);
  const reservations = await prisma.reservation.findMany({ where: { exchangeId: { in: storyExchanges.map((e) => e.id) } }, select: { id: true } });
  const ledgerTx = await prisma.ledgerTransaction.findMany({ where: { exchangeId: { in: storyExchanges.map((e) => e.id) } }, select: { id: true } });
  const auditTrail = await timelineFor(prisma, [
    ...storyExchanges.map((e) => e.id),
    ...storyExchanges.flatMap((e) => (e.dispute ? [e.dispute.id] : [])),
    ...reservations.map((r) => r.id),
    ...ledgerTx.map((t) => t.id),
  ]);

  // Chapter 5: Mei's invitation permission, invitations, notifications and the email previews linked to them.
  const [invitations, notifications, previews] = await Promise.all([
    listInvitations(prisma, mei.id),
    listNotifications(prisma, mei.id, { limit: 12 }),
    prisma.emailOutbox.findMany({ where: { memberId: mei.id, notificationId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 8 }),
  ]);

  // Edge cases: existing seeded records, looked up by what they are rather than by id.
  const ben = by('ben');
  const kofi = by('kofi');
  const lena = by('lena');
  const tomas = by('tomas');
  const catListing = find(alice?.id ?? '', (l) => l.trustTier === 'HIGH_TRUST');
  const catExchange = alice
    ? await prisma.exchange.findFirst({
        where: { providerId: mei.id, recipientId: alice.id, trustTier: 'HIGH_TRUST', status: { notIn: ['DECLINED', 'CANCELLED', 'WITHDRAWN'] } },
        orderBy: { createdAt: 'desc' },
      })
    : null;
  const floor = await floorExample(prisma);
  const kettle =
    kofi && lena ? await prisma.dispute.findFirst({ where: { exchange: { providerId: kofi.id, recipientId: lena.id } }, orderBy: { createdAt: 'asc' } }) : null;

  const { ledger: _m, ...meiOut } = meiP;
  const { ledger: _s, ...samOut } = samP;
  return {
    now: now.toISOString(),
    members: Object.fromEntries(members.map((m) => [m.handle, toSummary(m)])),
    chapters: WALKTHROUGH_CHAPTERS.map((c) => {
      const steps = guide.filter((s) => s.n >= c.from && s.n <= c.to);
      return { n: c.n, title: c.title, steps, done: steps.length > 0 && steps.every((s) => s.done) };
    }),
    trust: {
      cookingOffer: find(sam.id, (l) => l.type === 'OFFER' && l.category === 'Cooking'),
      tutoringOffer: find(mei.id, (l) => l.type === 'OFFER' && l.category === 'Tutoring'),
      translationOffer: find(mei.id, (l) => l.type === 'OFFER' && l.category === 'Translation'),
      catTask: catListing,
      path: findPath(trust, mei.id, sam.id),
      aliceVouch: vouch
        ? { edge: toEdgeView(vouch, now), liabilityMultiplier: liabilityMultiplier(vouch.liabilityPct), backedStrength: backedStrength(vouch.strength, vouch.liabilityPct) }
        : null,
    },
    story: {
      cooking: cookingView,
      tutoring: tutoringView,
      translation: translationView,
      trustUpdates: { cooking: cookingUpdate, tutoring: tutoringUpdate },
      disputeId: third?.dispute?.id ?? null,
      comparison: {
        settled: settledTimes.length,
        firstSettledAt: firstSettledAt?.toISOString() ?? null,
        lastSettledAt: lastSettledAt?.toISOString() ?? null,
        rows: [row(meiP), row(samP)],
        earned: {
          before: updates[0]?.previousStrength ?? null,
          after: updates.length ? updates[updates.length - 1].newStrength : null,
          relationshipTrustBefore: updates[0]?.relationshipTrustBefore ?? null,
          relationshipTrustAfter: updates.length ? updates[updates.length - 1].relationshipTrustAfter : null,
        },
      },
      auditTrail,
    },
    participants: { mei: meiOut, sam: samOut },
    results: {
      invitePermission: meiP.credibility.permissions.find((p) => p.key === 'invite') ?? null,
      invitations: invitations.map(toInvitationView),
      notifications: notifications.notifications,
      emailPreviews: previews.map(toOutboxView),
    },
    edgeCases: {
      status: Object.fromEntries((await checkDemoFixtures(prisma, now)).map((c) => [c.key, c])) as DemoWalkthroughView['edgeCases']['status'],
      catExchangeId: catExchange?.id ?? null,
      floorExchangeId: floor.exchange?.id ?? null,
      benCredits: ben ? await creditSummary(prisma, ben.id, now) : null,
      floor: floor.check,
      kettleDisputeId: kettle?.id ?? null,
      tomasCredits: tomas ? await creditSummary(prisma, tomas.id, now) : null,
      tomasExpiry: tomas ? await expiryView(prisma, tomas.id, now) : null,
      meiSkillClaims: await listSkillClaims(prisma, mei.id, now, { memberId: mei.id }),
      skillReviews: await skillReviewChecks(prisma),
    },
    seedVersion,
  };
}
