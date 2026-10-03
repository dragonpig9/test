import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat, StatusChip } from '../../components/ui';
import { credits, fmtDate } from '../../lib/format';
import { useCreditSummary, useLedgerEntries } from './api';

export function CreditsPage() {
  const s = useCreditSummary();
  const entries = useLedgerEntries();
  if (s.isLoading) return <Loading />;
  if (s.error) return <ErrorBox error={s.error} title="Could not load your credits" />;
  const d = s.data!;
  const range = 15; // visual scale: −5 … +10
  const pct = (v: number) => Math.min(100, Math.max(0, ((v / 100 + 5) / range) * 100));
  return (
    <div>
      <PageHeader title="Time Credits" subtitle="1 hour of help = 1 credit, for every kind of service. Credits cannot be bought, sold or converted to cash. All numbers below come from the ledger." />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Posted balance" value={credits(d.posted)} why={d.explanation.posted} />
        <Stat label="Reserved outgoing" value={credits(d.reservedOutgoing)} tone="muted" why="Credits held for exchanges you accepted (or that are disputed). They reduce your available balance but nobody is paid until settlement." />
        <Stat label="Available balance" value={credits(d.available)} tone={d.available < 0 ? 'warn' : 'good'} why={d.explanation.available} />
        <Stat label="Pending incoming" value={credits(d.pendingIncoming)} tone="muted" why="Credits others have reserved for services you will provide. They become yours only when the exchange settles." />
        <Stat label="Disputed (frozen)" value={`${credits(d.disputedOutgoing)} / ${credits(d.disputedIncoming)}`} sub="outgoing / incoming" tone={d.disputedOutgoing || d.disputedIncoming ? 'warn' : 'muted'} why="Reservations frozen by an open dispute. Frozen outgoing credits still count against your floor, so they cannot be spent twice." />
      </div>
      <Card className="mt-6" title="Credit floor">
        <p className="text-sm text-slate-600">{d.explanation.floor}</p>
        <div className="relative mt-4 h-3 rounded-full bg-gradient-to-r from-red-200 via-amber-100 to-emerald-200" aria-hidden>
          <div className="absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded bg-slate-900" style={{ left: `${pct(d.available)}%` }} title="available" />
          <div className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-red-700" style={{ left: '0%' }} />
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>floor {credits(d.floor)}</span>
          <span>0</span>
          <span>+10</span>
        </div>
        <p className="mt-2 text-sm">
          You can take on up to <strong className="num">{credits(Math.max(0, d.headroom))}</strong> more credits of new commitments.
        </p>
      </Card>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Reservations">
          {!d.reservations.length ? (
            <Empty title="No reservations" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.reservations.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <StatusChip status={r.status} />
                  <Link to={`/exchanges/${r.exchangeId}`} className="font-medium hover:text-brand-700">
                    {r.deliverable}
                  </Link>
                  <span className="ml-auto num">
                    {r.direction === 'outgoing' ? '−' : '+'}
                    {credits(r.total)}
                    {r.giftBonus ? <span className="text-xs text-slate-500"> (incl. {credits(r.giftBonus)} gift)</span> : null}
                  </span>
                  <span className="w-full text-xs text-slate-500">
                    {r.direction} · {fmtDate(r.createdAt)} {r.resolutionNote ? `· ${r.resolutionNote}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Dated credit lots and expiry">
          <p className="mb-3 text-xs text-slate-600">{d.expiry.note}</p>
          {!d.lots.length ? (
            <Empty title="No credit lots">Lots appear when you earn credits while your balance is positive. Debts never expire.</Empty>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1">Earned</th>
                  <th>Expires</th>
                  <th className="text-right">Original</th>
                  <th className="text-right">Remaining</th>
                  <th className="text-right">Protected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.lots.map((l) => (
                  <tr key={l.id} className={l.remaining === 0 ? 'text-slate-400' : ''}>
                    <td className="py-1.5">{fmtDate(l.earnedAt, false)}</td>
                    <td>
                      {fmtDate(l.expiresAt, false)} {l.expired && l.remaining > 0 && <span className="text-xs text-amber-700">(due)</span>}
                    </td>
                    <td className="text-right num">{credits(l.originalAmount)}</td>
                    <td className="text-right num">{credits(l.remaining)}</td>
                    <td className="text-right num">{credits(l.protectedByReservation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {d.expiry.expiringWithin30Days > 0 && <p className="mt-3 text-sm text-amber-800">{credits(d.expiry.expiringWithin30Days)} credit(s) expire within 30 days.</p>}
        </Card>
      </div>
      <Card className="mt-6" title="Ledger entries">
        {entries.isLoading ? (
          <Loading />
        ) : !entries.data?.entries.length ? (
          <Empty title="No ledger entries yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="pr-3">Type</th>
                  <th className="pr-3">Counterparty</th>
                  <th className="pr-3">Explanation</th>
                  <th className="pr-3 text-right">Amount</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap py-2 pr-3">{fmtDate(e.effectiveAt, false)}</td>
                    <td className="pr-3">
                      <StatusChip status={e.kind === 'EXPIRY' ? 'EXPIRED' : e.kind === 'POOL_DISTRIBUTION' ? 'ACCEPTED' : 'SETTLED'} label={e.kind === 'POOL_DISTRIBUTION' ? 'pool reward' : e.kind.toLowerCase()} />
                    </td>
                    <td className="pr-3">{e.counterparty}</td>
                    <td className="pr-3 text-slate-600">
                      {e.explanation} <span className="font-mono text-[10px] text-slate-400">{e.ruleId}</span>
                    </td>
                    <td className={`pr-3 text-right font-semibold num ${e.amount < 0 ? 'text-red-700' : 'text-brand-700'}`}>{credits(e.amount, true)}</td>
                    <td className="text-right num">{credits(e.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
