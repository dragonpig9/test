import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { CredibilityView } from '@commonhours/shared';
import { Card, Empty, ErrorBox, Loading, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';

export function CredibilityPage() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const memberId = params.get('member') ?? me?.member.id;
  const own = memberId === me?.member.id;
  const q = useQuery({ queryKey: ['credibility', own ? 'me' : memberId], queryFn: () => api<CredibilityView>(own ? '/credibility/me' : `/credibility/${memberId}`) });
  const who = useQuery({ queryKey: ['member', memberId], queryFn: () => api<{ member: { displayName: string } }>(`/members/${memberId}`), enabled: !own });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  return (
    <div>
      <PageHeader title={own ? 'My Credibility' : `Credibility: ${who.data?.member.displayName ?? ''}`} subtitle={c.disclaimer} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-end gap-4">
              <p className="text-5xl font-semibold text-brand-700 num">{c.score}</p>
              <p className="pb-2 text-sm text-slate-600">out of 100 · rule-based, recomputed from records</p>
            </div>
            <p className="mt-2 font-mono text-xs text-slate-600">{c.formula}</p>
          </Card>
          <Card title="Contributing factors">
            <ul className="space-y-4">
              {c.factors.map((f) => {
                const max = f.maxPoints ?? 0;
                const width = max > 0 ? Math.max(0, (f.points / max) * 100) : 0;
                return (
                  <li key={f.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{f.label}</span>
                      <span className={`font-semibold num ${f.points < 0 ? 'text-red-700' : ''}`}>
                        {f.points}
                        {max > 0 && <span className="text-xs font-normal text-slate-500"> / {max}</span>}
                      </span>
                    </div>
                    {max > 0 && (
                      <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden>
                        <div className="h-2 rounded-full bg-brand-600" style={{ width: `${width}%` }} />
                      </div>
                    )}
                    <p className="mt-1 font-mono text-xs text-slate-600">{f.calculation}</p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">{c.noHistoryNote}</p>
          </Card>
          <Card title="History of changes">
            {!c.history.length ? (
              <Empty title="No history yet" />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {c.history.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 py-2">
                    <span className={`w-14 text-right font-semibold num ${h.delta < 0 ? 'text-red-700' : 'text-brand-700'}`}>
                      {h.delta > 0 ? '+' : ''}
                      {h.delta}
                    </span>
                    <span className="w-12 text-right num">{h.score}</span>
                    <span className="flex-1 text-slate-700">{h.reason}</span>
                    <span className="text-xs text-slate-500">{fmtDate(h.createdAt, false)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Permissions">
            <ul className="space-y-3">
              {c.permissions.map((p) => (
                <li key={p.key} className={`rounded-xl border p-3 text-sm ${p.allowed ? 'border-brand-200 bg-brand-50' : 'border-slate-200'}`}>
                  <p className="font-semibold">
                    {p.allowed ? '✓ ' : '🔒 '}
                    {p.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">{p.explanation}</p>
                  {!p.allowed && p.toUnlock && <p className="mt-1 text-xs font-medium text-slate-800">To unlock: {p.toUnlock}</p>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Final findings">
            {!c.penalties.length ? (
              <p className="text-sm text-slate-600">No penalties. Opening a dispute never lowers credibility; only finalized findings do.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.penalties.map((p) => (
                  <li key={p.id} className="rounded-lg border border-red-200 bg-red-50 p-2.5">
                    <p className="font-semibold text-red-800">
                      −{p.points} · {p.kind.toLowerCase().replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-red-900">{p.finding}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
