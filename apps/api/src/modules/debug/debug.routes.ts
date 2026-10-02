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
      const { rows, candidates } = await computeEligibility(prisma, d.id, req.ctx.now);
      out.push({
        disputeId: d.id,
        status: d.status,
        parties: [d.exchange.provider.handle, d.exchange.recipient.handle],
        current: rows.map((r) => ({ ...r, handle: candidates.find((c) => c.id === r.memberId)!.handle })),
      });
    }
    res.json({ disputes: out });
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
