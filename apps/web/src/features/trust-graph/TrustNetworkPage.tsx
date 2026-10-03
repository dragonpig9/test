import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, ErrorBox, Loading, PageHeader, Tabs } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { VouchingPanel } from '../vouching/VouchingPanel';
import { useGraph, usePath } from './api';
import { EarnedEdgeDetails, EdgeDetails } from './EdgeDetails';
import { MemberProfilePanel } from './MemberProfile';
import { PathPanel } from './PathPanel';
import { TrustGraph } from './TrustGraph';

export function TrustNetworkPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'graph' | 'vouches') ?? 'graph';
  const graph = useGraph();
  const [from, setFrom] = useState<string | undefined>(me?.member.id);
  const [to, setTo] = useState<string | undefined>();
  const [focus, setFocus] = useState<string | undefined>();
  const [edgeId, setEdgeId] = useState<string | undefined>();
  const path = usePath(from, to);
  const members = useMemo(() => new Map((graph.data?.nodes ?? []).map((n) => [n.id, n])), [graph.data]);

  const pick = (id: string) => {
    setFocus(id);
    setEdgeId(undefined);
    if (!from || (from && to)) {
      setFrom(id);
      setTo(undefined);
    } else if (id !== from) setTo(id);
  };

  const disconnected = graph.data?.nodes.filter((n) => !n.connected) ?? [];
  const edge = graph.data?.edges.find((e) => e.id === edgeId);
  const earned = graph.data?.earnedEdges.find((e) => e.id === edgeId);
  return (
    <div>
      <PageHeader
        title="Trust Network"
        subtitle="Arrows point from voucher to vouched member. Solid green = active, dashed amber = decayed (12+ months without a settled exchange), dotted grey = expired or revoked (no reachability). Dotted violet = earned relationship from exchanges both members confirmed (no liability). Click a member to see their profile; click two members to highlight the strongest path."
      />
      <div className="mb-4">
        <Tabs
          label="Trust network views"
          value={tab}
          onChange={(v) => setParams(v === 'graph' ? {} : { tab: v })}
          options={[
            { value: 'graph', label: 'Graph & path finder' },
            { value: 'vouches', label: 'My vouches & invitations' },
          ]}
        />
      </div>
      {tab === 'vouches' ? (
        <VouchingPanel graph={graph.data} />
      ) : graph.isLoading ? (
        <Loading label="Loading the trust network…" />
      ) : graph.error ? (
        <ErrorBox error={graph.error} title="Could not load the network" />
      ) : (
        graph.data && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-4">
              <Card className="!p-3">
                <div className="mb-3 flex flex-wrap items-end gap-3 px-1">
                  <div className="text-sm">
                    <label className="label" htmlFor="path-from">From</label>
                    <select id="path-from" className="input" value={from ?? ''} onChange={(e) => setFrom(e.target.value || undefined)}>
                      <option value="">—</option>
                      {graph.data.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-sm">
                    <label className="label" htmlFor="path-to">To</label>
                    <select id="path-to" className="input" value={to ?? ''} onChange={(e) => setTo(e.target.value || undefined)}>
                      <option value="">—</option>
                      {graph.data.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="mb-0.5 text-sm text-slate-600 underline" onClick={() => { setFrom(undefined); setTo(undefined); }}>
                    Clear
                  </button>
                </div>
                <TrustGraph graph={graph.data} path={path.data} from={from} to={to} focusEdge={edgeId} onNode={pick} onEdge={(id) => setEdgeId(id)} />
                <p className="mt-2 px-1 text-xs text-slate-500">{graph.data.rules.undirectedNote}</p>
              </Card>
              {disconnected.length > 0 && (
                <Card title="Not connected to the main network">
                  <ul className="text-sm text-slate-700">
                    {disconnected.map((n) => (
                      <li key={n.id}>
                        {n.displayName} — {n.status === 'LEFT' ? 'has left the community' : 'no active vouch links them to the main group'}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <Card title="All vouches (table view)">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Voucher → vouched</th>
                        <th className="pr-3">Status</th>
                        <th className="pr-3">Strength</th>
                        <th className="pr-3">Liability</th>
                        <th className="pr-3">Age</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {graph.data.edges.map((e) => (
                        <tr key={e.id}>
                          <td className="py-2 pr-3">
                            {members.get(e.voucherId)?.displayName} → {members.get(e.voucheeId)?.displayName}
                          </td>
                          <td className="pr-3">{e.status.toLowerCase()}</td>
                          <td className="pr-3 num">{e.decayed ? `${e.strength}→${e.effectiveStrength}` : e.effectiveStrength}</td>
                          <td className="pr-3">{e.liabilityPct}%</td>
                          <td className="pr-3 num">{e.ageDays}d</td>
                          <td>
                            <button type="button" className="text-brand-700 hover:underline" onClick={() => setEdgeId(e.id)}>
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              {graph.data.earnedEdges.length > 0 && (
                <Card title="Earned relationships (table view)">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-slate-500">
                        <tr>
                          <th className="py-2 pr-3">Members</th>
                          <th className="pr-3">Strength</th>
                          <th className="pr-3">Confirmed exchanges</th>
                          <th className="pr-3">Last exchange</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {graph.data.earnedEdges.map((e) => (
                          <tr key={e.id}>
                            <td className="py-2 pr-3">
                              {members.get(e.memberAId)?.displayName} ↔ {members.get(e.memberBId)?.displayName}
                            </td>
                            <td className="pr-3 num">{e.decayed ? `${e.strength}→${e.effectiveStrength}` : e.status === 'EXPIRED' ? 'expired' : e.effectiveStrength}</td>
                            <td className="pr-3 num">{e.countedExchanges}</td>
                            <td className="pr-3">{e.lastExchangeAt.slice(0, 10)}</td>
                            <td>
                              <button type="button" className="text-brand-700 hover:underline" onClick={() => setEdgeId(e.id)}>
                                History
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
            <div className="min-w-0 space-y-4">
              {edge && <EdgeDetails edge={edge} members={members} onClose={() => setEdgeId(undefined)} />}
              {earned && <EarnedEdgeDetails edge={earned} members={members} onClose={() => setEdgeId(undefined)} />}
              <PathPanel path={path.data} loading={path.isLoading} error={path.error} ready={!!from && !!to && from !== to} />
              {focus && members.get(focus) && <MemberProfilePanel member={members.get(focus)!} />}
            </div>
          </div>
        )
      )}
    </div>
  );
}
