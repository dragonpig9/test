import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Tabs } from '../../components/ui';
import { api, recentClientCalls } from '../../lib/api';

/**
 * Development-only Debug panel. Shows backend state through /api/debug/* (which never returns
 * password hashes or tokens). Hidden in production builds unless VITE_ENABLE_DEBUG=true.
 */
const TABS = [
  { value: 'me', label: 'User & permissions', path: '/debug/me' },
  { value: 'policy', label: 'Policy', path: '/debug/policy' },
  { value: 'trust', label: 'Trust edges', path: '/debug/trust' },
  { value: 'exchanges', label: 'Exchange states', path: '/debug/exchanges' },
  { value: 'ledger', label: 'Ledger', path: '/debug/ledger' },
  { value: 'credibility', label: 'Credibility', path: '/debug/credibility' },
  { value: 'eligibility', label: 'Jury candidates', path: '/debug/eligibility' },
  { value: 'tasks', label: 'Task eligibility', path: '/debug/task-eligibility' },
  { value: 'pricing', label: 'Pricing', path: '/debug/pricing' },
  { value: 'trustUpdates', label: 'Trust updates', path: '/debug/trust-updates' },
  { value: 'notifications', label: 'Notifications & email', path: '/debug/notifications' },
  { value: 'requests', label: 'API requests & errors', path: '/debug/requests' },
  { value: 'audit', label: 'Audit events', path: '/debug/audit' },
] as const;
type Tab = (typeof TABS)[number]['value'];

export default function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('me');
  const path = TABS.find((t) => t.value === tab)!.path;
  const q = useQuery({ queryKey: ['debug', tab], queryFn: () => api<unknown>(path), enabled: open, refetchInterval: open && tab === 'requests' ? 3000 : false });
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} className="fixed bottom-4 right-4 z-40 hidden rounded-full sm:block bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-slate-700" aria-expanded={open}>
        {open ? 'Close debug' : 'Debug'}
      </button>
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-40 h-[55vh] overflow-hidden border-t-4 border-slate-900 bg-white shadow-2xl" role="region" aria-label="Debug panel">
          <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
              <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase text-white">dev only</span>
              <Tabs label="Debug tabs" value={tab} onChange={setTab} options={TABS.map((t) => ({ value: t.value, label: t.label }))} />
              <button type="button" className="ml-auto text-xs underline" onClick={() => q.refetch()}>
                refresh
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 font-mono text-[11px]">
              {tab === 'requests' && (
                <div className="mb-4">
                  <p className="mb-1 font-sans text-xs font-semibold">Browser-side calls (this tab)</p>
                  <table className="w-full text-left">
                    <tbody>
                      {recentClientCalls().slice(0, 40).map((c, i) => (
                        <tr key={i} className={c.status >= 400 || c.status === 0 ? 'text-red-700' : ''}>
                          <td className="pr-2">{c.at.slice(11, 19)}</td>
                          <td className="pr-2">{c.method}</td>
                          <td className="pr-2">{c.path}</td>
                          <td className="pr-2">{c.status}</td>
                          <td className="pr-2">{c.ms}ms</td>
                          <td className="pr-2">{c.errorCode ? `${c.errorCode} (${c.errorModule})` : ''}</td>
                          <td className="pr-2">{c.correlationId}</td>
                          <td>{c.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mb-1 mt-4 font-sans text-xs font-semibold">Server-side request log</p>
                </div>
              )}
              {q.isLoading ? 'Loading…' : q.error ? <span className="text-red-700">{(q.error as Error).message}</span> : <pre className="whitespace-pre-wrap">{JSON.stringify(q.data, null, 2)}</pre>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
