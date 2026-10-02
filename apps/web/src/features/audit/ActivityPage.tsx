import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuditEventView } from '@commonhours/shared';
import { Empty, ErrorBox, Loading, PageHeader, Tabs } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';

const MODULES = ['all', 'exchanges', 'ledger', 'attestation', 'credibility', 'vouches', 'invitations', 'services', 'withdrawal', 'demo'];

export function ActivityPage() {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [mod, setMod] = useState('all');
  const q = useQuery({ queryKey: ['audit', scope], queryFn: () => api<{ events: AuditEventView[] }>(`/audit?scope=${scope}`) });
  const rows = (q.data?.events ?? []).filter((e) => mod === 'all' || e.module === mod);
  return (
    <div>
      <PageHeader title="Activity" subtitle="A human-readable view of the domain audit trail. Every change to credits, credibility, vouches and exchange state is recorded in the same database transaction as the change itself." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs label="Activity scope" value={scope} onChange={setScope} options={[{ value: 'mine', label: 'Involving me' }, { value: 'all', label: 'Whole community' }]} />
        <label className="text-sm">
          <span className="sr-only">Module</span>
          <select className="input" value={mod} onChange={(e) => setMod(e.target.value)}>
            {MODULES.map((m) => (
              <option key={m} value={m}>
                {m === 'all' ? 'All modules' : m}
              </option>
            ))}
          </select>
        </label>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !rows.length ? (
        <Empty title="No activity" />
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={e.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <details>
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{e.module}</span>
                    <span className="font-medium text-slate-900">{e.summary}</span>
                    <span className="ml-auto text-xs text-slate-500">{fmtDate(e.occurredAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{e.actor ? <MemberChip m={e.actor} /> : 'system'}</div>
                </summary>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <p>
                    <strong>Reason:</strong> {e.reason}
                  </p>
                  <p>
                    <strong>Rule:</strong> <span className="font-mono">{e.ruleId}</span> · {e.policyVersion}
                  </p>
                  <p>
                    <strong>Entity:</strong> {e.entityType} <span className="font-mono">{e.entityId}</span>
                  </p>
                  <p>
                    <strong>Action / correlation:</strong> <span className="font-mono">{e.action}</span> · <span className="font-mono">{e.correlationId}</span>
                  </p>
                  <pre className="overflow-x-auto rounded bg-slate-50 p-2">before: {JSON.stringify(e.before, null, 1)}</pre>
                  <pre className="overflow-x-auto rounded bg-slate-50 p-2">after: {JSON.stringify(e.after, null, 1)}</pre>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
