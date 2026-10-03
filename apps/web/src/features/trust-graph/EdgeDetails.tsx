import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { EarnedEdgeView, EdgeView, MemberSummary, TrustUpdateView } from '@commonhours/shared';
import { Card, KV, Loading, StatusChip } from '../../components/ui';
import { api } from '../../lib/api';
import { MemberChip } from '../../components/MemberChip';
import { fmtDate } from '../../lib/format';

export function EdgeDetails({ edge, members, onClose }: { edge: EdgeView; members: Map<string, MemberSummary>; onClose: () => void }) {
  const a = members.get(edge.voucherId);
  const b = members.get(edge.voucheeId);
  return (
    <Card
      title="Vouch details"
      actions={
        <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="mb-3 text-sm">
        {a && <MemberChip m={a} />} <span className="mx-1 text-slate-400">vouched for</span> {b && <MemberChip m={b} />}
      </p>
      <KV
        items={[
          ['Direction', `${a?.displayName} → ${b?.displayName} (voucher → vouched member)`],
          ['Status', <StatusChip key="s" status={edge.status} />],
          ['Strength', edge.decayed ? `${edge.strength} stored, ${edge.effectiveStrength} effective (decayed)` : edge.effectiveStrength !== edge.strength ? `${edge.strength} stored, ${edge.effectiveStrength} backed by ${edge.liabilityPct}% liability` : `${edge.effectiveStrength}`],
          ['Liability', `${edge.liabilityPct}% → max ${edge.maxPenaltyPoints} credibility points for ${a?.displayName}`],
          ['Created', fmtDate(edge.createdAt, false)],
          ['Age', `${edge.ageDays} days`],
          ['Last qualifying interaction', fmtDate(edge.lastInteractionAt, false)],
          ['Expires', fmtDate(edge.expiresAt, false)],
        ]}
      />
      <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">{edge.explanation}</p>
      <p className="mt-2 text-xs text-slate-500">Liability is a bounded credibility penalty after a final nonperformance finding. It never moves credits and never cascades past the direct voucher.</p>
    </Card>
  );
}

/** Earned relationship and its change history (previous → new, reason, exchange, timestamp). */
export function EarnedEdgeDetails({ edge, members, onClose }: { edge: EarnedEdgeView; members: Map<string, MemberSummary>; onClose: () => void }) {
  const history = useQuery({ queryKey: ['trust', 'updates', edge.id], queryFn: () => api<{ updates: TrustUpdateView[] }>(`/trust/updates?relationship=${edge.id}`) });
  const a = members.get(edge.memberAId);
  const b = members.get(edge.memberBId);
  return (
    <Card
      title="Earned relationship"
      actions={
        <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="mb-3 text-sm">
        {a && <MemberChip m={a} />} <span className="mx-1 text-slate-400">↔</span> {b && <MemberChip m={b} />}
      </p>
      <KV
        items={[
          ['Strength', edge.decayed ? `${edge.strength} stored, ${edge.effectiveStrength} effective (decayed)` : `${edge.effectiveStrength}`],
          ['Status', edge.status.toLowerCase()],
          ['Counted exchanges', String(edge.countedExchanges)],
          ['Since', fmtDate(edge.createdAt, false)],
          ['Last confirmed exchange', fmtDate(edge.lastExchangeAt, false)],
        ]}
      />
      <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">{edge.explanation} Unlike a vouch, nobody carries liability for an earned relationship.</p>
      <h3 className="mb-1 mt-4 text-sm">History</h3>
      {history.isLoading ? (
        <Loading />
      ) : (
        <ul className="space-y-2 text-xs">
          {history.data?.updates.map((u) => (
            <li key={u.id} className="rounded-lg border border-slate-200 p-2">
              <p className="font-medium">
                {u.previousStrength} → {u.newStrength} {u.applied ? '' : '(no change)'} · {fmtDate(u.createdAt)}
              </p>
              <p className="text-slate-600">{u.reason}</p>
              <Link to={`/exchanges/${u.exchangeId}`} className="text-brand-700 hover:underline">
                {u.exchangeDeliverable ?? 'Open exchange'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
