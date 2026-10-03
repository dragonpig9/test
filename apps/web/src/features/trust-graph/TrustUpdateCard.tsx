import { Link } from 'react-router-dom';
import type { TrustUpdateView } from '@commonhours/shared';
import { Card, KV } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { fmtDate } from '../../lib/format';

/** Earned-trust change from one exchange: previous → new strength, reason, exchange and time. */
export function TrustUpdateCard({ u, title = 'Earned trust from this exchange' }: { u: TrustUpdateView; title?: string }) {
  return (
    <Card title={title}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <MemberChip m={u.members[0]} /> <span className="text-slate-400">↔</span> <MemberChip m={u.members[1]} />
      </div>
      <KV
        items={[
          ['Previous strength', String(u.previousStrength)],
          ['New strength', <span key="n" className={u.applied ? 'text-brand-700' : 'text-slate-600'}>{u.newStrength}{u.applied ? '' : ' (no change)'}</span>],
          ['Reason', u.reason],
          ['Relationship trust', u.relationshipTrustBefore === null ? '—' : `${u.relationshipTrustBefore} → ${u.relationshipTrustAfter} (strongest path; never lowered by a new edge)`],
          ['Related exchange', <Link key="x" to={`/exchanges/${u.exchangeId}`} className="text-brand-700 hover:underline">{u.exchangeDeliverable ?? 'Open exchange'}</Link>],
          ['When', fmtDate(u.createdAt)],
        ]}
      />
      <p className="mt-3 text-xs text-slate-500">Earned relationships come only from exchanges both members confirmed. They carry no voucher liability, are capped at 0.7 and count at most twice per pair per 30 days. Rule {u.ruleId}.</p>
    </Card>
  );
}
