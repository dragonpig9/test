import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, StatusChip, Tabs } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { useGraph } from '../trust-graph/api';
import { declareConflict, useConflicts, useDisputes } from './api';

export function DisputesPage() {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const q = useDisputes(scope);
  return (
    <div>
      <PageHeader title="Disputes" subtitle="Disagreements are judged only against the terms agreed before the service, by randomly selected eligible attestors. Credits stay frozen until there is a final outcome — the system never silently picks a winner." />
      <div className="mb-4">
        <Tabs label="Dispute scope" value={scope} onChange={setScope} options={[{ value: 'mine', label: 'Mine & my attestations' }, { value: 'all', label: 'All community disputes' }]} />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data?.disputes.length ? (
        <Empty title="No disputes">Good news. If an agreed condition is not met you can open one from the exchange page.</Empty>
      ) : (
        <ul className="space-y-3">
          {q.data.disputes.map((d) => (
            <li key={d.id}>
              <Link to={`/disputes/${d.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={d.status} />
                  {d.outcome && <StatusChip status={d.outcome} />}
                  {d.awaitingMyVote && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white">Your vote is needed</span>}
                  <span className="font-semibold">{d.deliverable}</span>
                  <span className="ml-auto text-xs text-slate-500">{fmtDate(d.createdAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-600">
                  <MemberChip m={d.provider} suffix="provider" />
                  <MemberChip m={d.recipient} suffix="recipient" />
                  <span>Condition: {d.condition.toLowerCase()}</span>
                  <span>You: {d.myRole}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ConflictsCard />
    </div>
  );
}

function ConflictsCard() {
  const { me } = useAuth();
  const conflicts = useConflicts();
  const graph = useGraph();
  const [other, setOther] = useState('');
  const [reason, setReason] = useState('');
  const save = useAction(() => declareConflict(other, reason), () => { setOther(''); setReason(''); });
  return (
    <Card className="mt-8" title="Conflicts of interest">
      <p className="text-sm text-slate-600">Declaring a conflict excludes you from attesting disputes involving that member (and them from yours). Graph distance alone does not guarantee independence.</p>
      <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto]" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <Field label="Member" htmlFor="cm">
          <select id="cm" className="input" value={other} onChange={(e) => setOther(e.target.value)} required>
            <option value="">Choose…</option>
            {graph.data?.nodes.filter((n) => n.id !== me?.member.id).map((n) => (
              <option key={n.id} value={n.id}>
                {n.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason" htmlFor="cr">
          <input id="cr" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="e.g. we are flatmates" />
        </Field>
        <div className="self-end">
          <Button type="submit" variant="secondary" busy={save.isPending}>
            Declare
          </Button>
        </div>
      </form>
      <div className="mt-2">
        <ErrorBox error={save.error} />
      </div>
      {conflicts.data?.conflicts.length ? (
        <ul className="mt-4 space-y-1 text-sm">
          {conflicts.data.conflicts.map((c) => (
            <li key={c.id}>
              {c.member.displayName} ↔ {c.other.displayName}: {c.reason} <span className="text-xs text-slate-500">({fmtDate(c.createdAt, false)})</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
