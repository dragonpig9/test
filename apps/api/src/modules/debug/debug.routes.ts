import { Router } from 'express';
import { POLICY } from '../../config/policy';
import { prisma } from '../../core/db';
import { actorId, ah } from '../../core/http';
import { recentRequests } from '../../core/request-log';
import { listAudit } from '../audit/audit.repo';
import { computeEligibility } from '../attestation/attestation.service';
import { computeCredibility, permissionsOf } from '../credibility/credibility.service';
import { getMember, toProfile } from '../members/member.repo';
import { graphView, loadTrust } from '../trust/trust.service';
import { creditSummary } from '../ledger/ledger.service';
import { deliveryConfigSummary } from '../notifications/email.provider';
import { toOutboxView } from '../notifications/notification.service';
import { demandFor, pricingOf } from '../pricing/pricing.service';
import { effectiveSkillTiers } from '../pricing/pricing.skills';
import { exchangeEligibility, listingEligibility } from '../task-eligibility/eligibility.service';
import { trustUpdatesFor } from '../trust/trust.earned';
import { SERVICE_CATEGORIES } from '@commonhours/shared';

/**
 * Development-only inspection endpoints for the Debug panel.
 * Never returns password hashes or tokens. Mounted only when DEBUG_ENDPOINTS=true and NODE_ENV != production.
 */
export const debugRouter = Router();

debugRouter.get(
  '/me',
  ah(async (req, res) => {
    const me = await getMember(prisma, actorId(req, 'debug'));
    res.json({ member: toProfile(me), permissions: await permissionsOf(prisma, me.id, req.ctx.now), correlationId: req.ctx.correlationId, now: req.ctx.now });
  }),
);

debugRouter.get('/policy', (_req, res) => {
  res.json({ policy: POLICY });
});

debugRouter.get(
  '/trust',
  ah(async (req, res) => {
    res.json(graphView(await loadTrust(prisma, req.ctx.now)));
  }),
);

debugRouter.get(
  '/exchanges',
  ah(async (_req, res) => {
    const rows = await prisma.exchange.findMany({
      include: { provider: { select: { handle: true } }, recipient: { select: { handle: true } }, reservation: true, dispute: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      exchanges: rows.map((e) => ({
        id: e.id,
        status: e.status,
        provider: e.provider.handle,
        recipient: e.recipient.handle,
        deliverable: e.deliverable,
        creditAmount: e.creditAmount,
        giftBonus: e.giftBonus,
        termsVersion: e.termsVersion,
        scheduledAt: e.scheduledAt,
        reservation: e.reservation && { status: e.reservation.status, amount: e.reservation.amount, giftBonus: e.reservation.giftBonus },
        dispute: e.dispute,
      })),
    });
  }),
);

debugRouter.get(
  '/ledger',
  ah(async (req, res) => {
    const [transactions, reservations, members] = await Promise.all([
      prisma.ledgerTransaction.findMany({ include: { entries: { include: { account: true } } }, orderBy: { effectiveAt: 'desc' }, take: 200 }),
      prisma.reservation.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.member.findMany({ orderBy: { handle: 'asc' } }),
    ]);
    const balances = [];
    for (const m of members) {
      const s = await creditSummary(prisma, m.id, req.ctx.now);
      const lotSum = s.lots.reduce((a, l) => a + l.remaining, 0);
      balances.push({ handle: m.handle, posted: s.posted, reservedOutgoing: s.reservedOutgoing, available: s.available, lotSum, lotInvariantOk: lotSum === Math.max(s.posted, 0) });
    }
    const totalPosted = await prisma.ledgerEntry.aggregate({ _sum: { amount: true } });
    res.json({
      ledgerBalanced: (totalPosted._sum.amount ?? 0) === 0,
      balances,
      reservations,
      transactions: transactions.map((t) => ({
        id: t.id,
        kind: t.kind,
        explanation: t.explanation,
        ruleId: t.ruleId,
        effectiveAt: t.effectiveAt,
        idempotencyKey: t.idempotencyKey,
        sum: t.entries.reduce((a, e) => a + e.amount, 0),
        entries: t.entries.map((e) => ({ account: e.account.name, amount: e.amount })),
      })),
    });
  }),
);

debugRouter.get(
  '/credibility',
  ah(async (req, res) => {
    const members = await prisma.member.findMany({ orderBy: { handle: 'asc' } });
    const rows = [];
    for (const m of members) rows.push({ handle: m.handle, ...(await computeCredibility(prisma, m.id, req.ctx.now)) });
    res.json({ members: rows });
  }),
);

debugRouter.get(
  '/eligibility',
  ah(async (req, res) => {
    const disputes = await prisma.dispute.findMany({ orderBy: { createdAt: 'desc' }, include: { exchange: { include: { provider: true, recipient: true } } } });
    const out = [];
    for (const d of disputes) {
      const { candidates, rank, annotate } = await computeEligibility(prisma, d.id, req.ctx.now);
      // Preview ranking with a fixed debug seed (the real draw uses the seed stored on each selection).
      const ranked = rank('debug-preview');
      const rows = annotate(ranked, new Set());
      const last = await prisma.attestorSelection.findFirst({ where: { disputeId: d.id }, orderBy: { createdAt: 'desc' } });
      out.push({
        disputeId: d.id,
        status: d.status,
        parties: [d.exchange.provider.handle, d.exchange.recipient.handle],
        rule: 'filter (party, active, available, ≥2 hops, no direct vouch/invite, no conflict, credibility ≥ attest threshold, not already selected) → rank by closeness = max(relationship trust to each party), lowest first',
        current: rows
          .map((r) => ({ handle: candidates.find((c) => c.id === r.memberId)!.handle, eligible: r.eligible, closeness: r.closeness, rank: r.rank, included: r.eligible ? r.selectionReason : null, excludedBecause: r.eligible ? null : r.reasons, score: r.score, distances: r.distances }))
          .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
        lastStoredSelection: last && { round: last.round, method: last.method, seed: last.seed, selectedIds: last.selectedIds, sufficient: last.sufficient, candidates: last.candidates },
      });
    }
    res.json({ disputes: out });
  }),
);

debugRouter.get(
  '/task-eligibility',
  ah(async (req, res) => {
    const [members, requests, proposed] = await Promise.all([
      prisma.member.findMany({ where: { status: 'ACTIVE' }, orderBy: { handle: 'asc' } }),
      prisma.listing.findMany({ where: { type: 'REQUEST', status: 'OPEN' }, include: { owner: true } }),
      prisma.exchange.findMany({ where: { status: 'PROPOSED' }, include: { provider: { select: { handle: true } }, recipient: { select: { handle: true } } } }),
    ]);
    const listings = [];
    for (const l of requests) {
      const perMember = [];
      for (const m of members.filter((x) => x.id !== l.ownerId)) {
        const e = (await listingEligibility(prisma, m, [l], req.ctx.now)).get(l.id)!;
        perMember.push({ handle: m.handle, eligible: !e.locked, required: e.requiredCredibility, current: e.currentCredibility, blocked: e.checks.filter((c) => !c.passed).map((c) => `${c.label}: needs ${c.required}, has ${c.current}`) });
      }
      listings.push({ listing: l.title, owner: l.owner.handle, tier: l.trustTier, minCredibility: l.minCredibility, minRelationshipTrust: l.minRelationshipTrust, members: perMember });
    }
    const exchanges = [];
    for (const ex of proposed) exchanges.push({ id: ex.id, deliverable: ex.deliverable, provider: ex.provider.handle, recipient: ex.recipient.handle, tier: ex.trustTier, eligibility: await exchangeEligibility(prisma, ex, req.ctx.now) });
    res.json({ tiers: POLICY.taskEligibility.tiers, openRequests: listings, proposedExchanges: exchanges });
  }),
);

debugRouter.get(
  '/pricing',
  ah(async (req, res) => {
    const demand = [];
    for (const c of SERVICE_CATEGORIES) demand.push({ category: c, ...(await demandFor(prisma, c, req.ctx.now)) });
    const members = await prisma.member.findMany({ orderBy: { handle: 'asc' } });
    const tiers = [];
    for (const m of members) tiers.push({ handle: m.handle, nonStandard: (await effectiveSkillTiers(prisma, m.id)).filter((t) => t.tier !== 'STANDARD') });
    const recent = await prisma.exchange.findMany({ orderBy: { createdAt: 'desc' }, take: 15, include: { provider: { select: { handle: true } }, recipient: { select: { handle: true } } } });
    res.json({
      policy: POLICY.pricing,
      demand,
      skillTiers: tiers,
      exchanges: recent.map((e) => ({ id: e.id, deliverable: e.deliverable, status: e.status, provider: e.provider.handle, recipient: e.recipient.handle, priceLocked: !!e.priceLockedAt, creditAmount: e.creditAmount, giftBonus: e.giftBonus, pricing: pricingOf(e) })),
    });
  }),
);

debugRouter.get(
  '/trust-updates',
  ah(async (req, res) => {
    const earned = await prisma.earnedRelationship.findMany({ include: { memberA: { select: { handle: true } }, memberB: { select: { handle: true } } }, orderBy: { updatedAt: 'desc' } });
    res.json({
      policy: POLICY.earnedTrust,
      earnedRelationships: earned.map((r) => ({ pair: `${r.memberA.handle} ↔ ${r.memberB.handle}`, strength: r.strength, countedExchanges: r.countedExchanges, lastExchangeAt: r.lastExchangeAt })),
      updates: await trustUpdatesFor(prisma, { limit: 50 }),
    });
  }),
);

debugRouter.get(
  '/notifications',
  ah(async (_req, res) => {
    const [notifications, outbox] = await Promise.all([
      prisma.notification.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 60, include: { member: { select: { handle: true } } } }),
      prisma.emailOutbox.findMany({ orderBy: { createdAt: 'desc' }, take: 40 }),
    ]);
    const statusCounts = await prisma.emailOutbox.groupBy({ by: ['status'], _count: { _all: true } });
    res.json({
      email: deliveryConfigSummary(),
      outboxStatusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
      notifications: notifications.map((n) => ({ to: n.member.handle, kind: n.kind, title: n.title, dedupeKey: n.dedupeKey, read: !!n.readAt, at: n.createdAt })),
      outbox: outbox.map(toOutboxView),
    });
  }),
);

debugRouter.get('/requests', (_req, res) => {
  res.json({ requests: recentRequests() });
});

debugRouter.get(
  '/audit',
  ah(async (_req, res) => {
    res.json({ events: await listAudit(prisma, { limit: 100 }) });
  }),
);
