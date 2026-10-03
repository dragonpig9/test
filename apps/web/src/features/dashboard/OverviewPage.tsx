import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AuditEventView, CreditSummary, CredibilityView, ExchangeView } from '@commonhours/shared';
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat, StatusChip } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { credits, fmtDate } from '../../lib/format';
import { DemoGuide } from '../demo/DemoGuide';
import { useNotifications } from '../notifications/api';
import { NotificationList } from '../notifications/NotificationList';

interface DisputeRow {
  id: string;
  deliverable: string;
  status: string;
  awaitingMyVote: boolean;
}

export function OverviewPage() {
  const { me } = useAuth();
  const summary = useQuery({ queryKey: ['credits'], queryFn: () => api<CreditSummary>('/credits/summary') });
  const cred = useQuery({ queryKey: ['credibility', 'me'], queryFn: () => api<CredibilityView>('/credibility/me') });
  const ex = useQuery({ queryKey: ['exchanges'], queryFn: () => api<{ exchanges: ExchangeView[] }>('/exchanges') });
  const disputes = useQuery({ queryKey: ['disputes', 'mine'], queryFn: () => api<{ disputes: DisputeRow[] }>('/disputes') });
  const vouches = useQuery({ queryKey: ['vouches'], queryFn: () => api<{ vouches: { id: string; status: string; direction: string; voucher: { displayName: string } }[] }>('/vouches') });
  const activity = useQuery({ queryKey: ['audit', 'mine', 'short'], queryFn: () => api<{ events: AuditEventView[] }>('/audit') });
  const notifications = useNotifications({ limit: 6 });
  if (!me) return null;
  const s = summary.data;
  const attention = [
    ...(ex.data?.exchanges ?? [])
      .filter((e) => e.actions.some((a) => a.allowed && ['accept', 'confirm', 'acceptPartial'].includes(a.key)))
      .map((e) => ({ key: e.id, to: `/exchanges/${e.id}`, text: `${e.status === 'PROPOSED' ? 'Review and accept' : 'Confirm completion of'}: ${e.deliverable}`, chip: e.status })),
    ...(disputes.data?.disputes ?? []).filter((d) => d.awaitingMyVote).map((d) => ({ key: d.id, to: `/disputes/${d.id}`, text: `Your attestation vote is needed: ${d.deliverable}`, chip: 'AWAITING_ATTESTATION' })),
    ...(vouches.data?.vouches ?? []).filter((v) => v.status === 'PENDING' && v.direction === 'incoming').map((v) => ({ key: v.id, to: '/trust?tab=vouches', text: `${v.voucher.displayName} wants to vouch for you`, chip: 'PENDING' })),
  ];
  return (
    <div>
      <PageHeader title={`Hello, ${me.member.displayName.split(' ')[0]}`} subtitle={`Current ${me.demoMode ? 'simulated ' : ''}time: ${fmtDate(me.now)}. Everything below is computed by the server from recorded exchanges, vouches and findings.`} />
      {me.member.status === 'LEFT' && (
        <div className="mb-6 rounded-xl border border-slate-300 bg-slate-100 p-4 text-sm">You have left the community. You can still finish accepted exchanges, disputes and attestation duties; new commitments are blocked.</div>
      )}
      {summary.isLoading ? (
        <Loading />
      ) : summary.error ? (
        <ErrorBox error={summary.error} title="Could not load balances" />
      ) : (
        s && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Available balance" value={credits(s.available)} tone={s.available < 0 ? 'warn' : 'good'} why={s.explanation.available} sub={`floor ${credits(s.floor)} · headroom ${credits(s.headroom)}`} />
            <Stat label="Posted balance" value={credits(s.posted)} why={s.explanation.posted} />
            <Stat label="Reserved for agreed work" value={credits(s.reservedOutgoing)} tone="muted" why="Credits reserved for exchanges you accepted (or that are disputed). Reserved credits are not paid until settlement." />
            <Stat
              label="Credibility"
              value={cred.data ? cred.data.score : '…'}
              why={
                <span>
                  {cred.data?.formula}{' '}
                  <Link to="/credibility" className="font-medium text-brand-700 underline">
                    See each factor
                  </Link>
                </span>
              }
            />
          </div>
        )
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Needs your attention">
            {ex.isLoading ? (
              <Loading />
            ) : attention.length ? (
              <ul className="divide-y divide-slate-100">
                {attention.map((a) => (
                  <li key={a.key} className="flex items-center justify-between gap-3 py-2.5">
                    <Link to={a.to} className="text-sm font-medium text-slate-900 hover:text-brand-700">
                      {a.text}
                    </Link>
                    <StatusChip status={a.chip} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Nothing waiting on you">Browse the Service Board to offer or request help.</Empty>
            )}
          </Card>
          <Card
            title={`Recent notifications${notifications.data?.unread ? ` (${notifications.data.unread} unread)` : ''}`}
            actions={<Link to="/notifications" className="text-sm font-medium text-brand-700 hover:underline">All notifications</Link>}
          >
            {notifications.isLoading ? (
              <Loading />
            ) : notifications.data?.notifications.length ? (
              <NotificationList items={notifications.data.notifications} compact />
            ) : (
              <Empty title="No notifications yet">Task requests, settlements, trust changes and jury duty appear here.</Empty>
            )}
          </Card>
          <Card title="Recent activity" actions={<Link to="/activity" className="text-sm font-medium text-brand-700 hover:underline">All activity</Link>}>
            {activity.isLoading ? (
              <Loading />
            ) : activity.data?.events.length ? (
              <ul className="space-y-3">
                {activity.data.events.slice(0, 7).map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="text-slate-900">{e.summary}</p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(e.occurredAt)} · {e.actor ? <MemberChip m={e.actor} /> : 'system'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No activity yet" />
            )}
          </Card>
        </div>
        <div className="space-y-6">
          {me.demoMode && (
            <Card>
              <DemoGuide inline />
            </Card>
          )}
          <Card title="Permissions">
            <ul className="space-y-2 text-sm">
              {me.permissions.map((p) => (
                <li key={p.key} className="flex items-start gap-2">
                  <span aria-hidden className={p.allowed ? 'text-brand-700' : 'text-slate-400'}>
                    {p.allowed ? '●' : '○'}
                  </span>
                  <span>
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-slate-500">{p.allowed ? 'Unlocked' : p.toUnlock}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
