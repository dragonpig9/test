import { useQuery } from '@tanstack/react-query';
import type { CommunityPoolView } from '@commonhours/shared';
import { Card, ErrorBox, KV, Loading, Why } from '../../components/ui';
import { api } from '../../lib/api';
import { credits, fmtDate } from '../../lib/format';

export const useCommunityPool = () => useQuery({ queryKey: ['community-pool'], queryFn: () => api<CommunityPoolView>('/community-pool') });

/** Community Credit Pool: balance, last daily distribution and the exact arithmetic. */
export function CommunityPoolCard() {
  const q = useCommunityPool();
  const p = q.data;
  const d = p?.lastDistribution;
  return (
    <Card title="Community Credit Pool">
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} title="Could not load the pool" />
      ) : (
        p && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-slate-500">Pool balance</div>
              <div className="num text-2xl font-semibold text-brand-700">{credits(p.balance)}</div>
              <div className="text-xs text-slate-500">Next distribution {fmtDate(p.nextRunAt)} (00:00 Hong Kong time)</div>
            </div>
            {d ? (
              <>
                <KV
                  items={[
                    ['Last distribution', d.runDate],
                    ['Recipients', `${d.recipientCount} of ${d.activeUserCount} active`],
                    ['Each received', d.status === 'PAID' ? credits(d.paymentPerRecipient) : '—'],
                    ['Retained remainder', credits(d.remaining)],
                  ]}
                />
                <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{d.explanation}</p>
              </>
            ) : (
              <p className="text-xs text-slate-500">No distribution yet.</p>
            )}
            {p.myLastGrant && (
              <p className="text-xs text-brand-800">
                You last received {credits(p.myLastGrant.amount)} on {p.myLastGrant.runDate}.
              </p>
            )}
            <Why label="How does the pool work?">
              <ul className="list-disc space-y-1 pl-4">
                {p.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Why>
          </div>
        )
      )}
    </Card>
  );
}
