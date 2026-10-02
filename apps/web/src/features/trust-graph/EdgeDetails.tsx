import type { EdgeView, MemberSummary } from '@commonhours/shared';
import { Card, KV, StatusChip } from '../../components/ui';
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
          ['Strength', edge.decayed ? `${edge.strength} stored, ${edge.effectiveStrength} effective (decayed)` : `${edge.effectiveStrength}`],
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
