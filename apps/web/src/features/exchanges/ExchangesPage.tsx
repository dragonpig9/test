import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExchangeView } from '@commonhours/shared';
import { Empty, ErrorBox, Loading, PageHeader, StatusChip, Tabs } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { credits, duration, fmtDate } from '../../lib/format';
import { useExchanges } from './api';

type Group = 'action' | 'active' | 'done' | 'closed';
const groupOf = (e: ExchangeView): Group => {
  if (e.actions.some((a) => a.allowed && ['accept', 'confirm', 'acceptPartial'].includes(a.key))) return 'action';
  if (['PROPOSED', 'ACCEPTED', 'DISPUTED'].includes(e.status)) return 'active';
  if (e.status === 'SETTLED') return 'done';
  return 'closed';
};

export function ExchangesPage() {
  const q = useExchanges();
  const [tab, setTab] = useState<Group>('action');
  const all = q.data?.exchanges ?? [];
  const rows = all.filter((e) => groupOf(e) === tab);
  const count = (g: Group) => all.filter((e) => groupOf(e) === g).length;
  return (
    <div>
      <PageHeader title="My Exchanges" subtitle="Each exchange is a separate agreement with its own terms, reservation and confirmations — even when two exchanges are linked as a swap." />
      <div className="mb-4">
        <Tabs
          label="Exchange groups"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'action', label: 'Needs my action', count: count('action') },
            { value: 'active', label: 'In progress', count: count('active') },
            { value: 'done', label: 'Settled', count: count('done') },
            { value: 'closed', label: 'Closed', count: count('closed') },
          ]}
        />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !rows.length ? (
        <Empty title="Nothing here">Find someone on the Service Board to start an exchange.</Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map((e) => (
            <li key={e.id}>
              <Link to={`/exchanges/${e.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={e.status} />
                  <span className="font-semibold text-slate-900">{e.deliverable}</span>
                  {e.linkedExchangeId && <span className="rounded bg-teal-50 px-1.5 text-xs text-teal-800">linked swap</span>}
                  <span className="ml-auto text-sm num">
                    {e.myRole === 'recipient' ? 'you pay ' : e.myRole === 'provider' ? 'you earn ' : ''}
                    <strong>{credits(e.creditAmount + e.giftBonus)}</strong>
                    {e.giftBonus > 0 && <span className="text-xs text-slate-500"> (incl. {credits(e.giftBonus)} gift)</span>}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                  <span>
                    <MemberChip m={e.provider} suffix="provides" />
                  </span>
                  <span>
                    <MemberChip m={e.recipient} suffix="receives" />
                  </span>
                  <span>
                    {duration(e.durationMinutes)} · {fmtDate(e.scheduledAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
