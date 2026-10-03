import type { PathResult } from '@commonhours/shared';
import { Card, Empty, ErrorBox, Loading, Why } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';

export function PathPanel({ path, loading, error, ready }: { path?: PathResult; loading: boolean; error: unknown; ready: boolean }) {
  return (
    <Card title="Trust path">
      {!ready ? (
        <Empty title="Select two members">Click a member in the graph (from), then another (to), or use the pickers above.</Empty>
      ) : loading ? (
        <Loading label="Finding the strongest active path…" />
      ) : error ? (
        <ErrorBox error={error} />
      ) : path && !path.found ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">Not connected</p>
          <p className="mt-1">{path.explanation}</p>
        </div>
      ) : path ? (
        <div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-3xl font-semibold text-teal-700 num">{path.strength}</p>
            <p className="text-sm text-slate-600">relationship trust · {path.hops} hop(s){path.fewestVouchHops !== undefined && path.fewestVouchHops !== null && path.fewestVouchHops !== path.hops ? ` · fewest vouch hops: ${path.fewestVouchHops}` : ''}</p>
          </div>
          <p className="mt-1 font-mono text-sm text-slate-700">{path.calculation}</p>
          <ol className="mt-4 space-y-2">
            {path.steps.map((s, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <MemberChip m={s.from} />
                  <span className="text-slate-400" aria-hidden>
                    →
                  </span>
                  <MemberChip m={s.to} />
                  <span className="ml-auto font-mono text-xs">× {s.strength}</span>
                </div>
                {s.edge && (
                  <p className="mt-1 text-xs text-slate-500">
                    Vouch {s.edge.effectiveStrength}: {s.forward ? `${s.from.displayName} vouched for ${s.to.displayName}` : `${s.to.displayName} vouched for ${s.from.displayName} (walked backwards — not an endorsement by ${s.from.displayName})`} · {s.edge.ageDays} days old · {s.edge.explanation}
                  </p>
                )}
                {s.earned && (
                  <p className="mt-1 text-xs text-violet-700">
                    Earned {s.earned.effectiveStrength}: {s.earned.countedExchanges} confirmed exchange(s) between them · {s.earned.explanation}
                  </p>
                )}
                {s.kind === 'both' && <p className="mt-1 font-mono text-[11px] text-slate-500">1 − (1 − {s.edge!.effectiveStrength}) × (1 − {s.earned!.effectiveStrength}) = {s.strength}</p>}
              </li>
            ))}
          </ol>
          <Why label="How is this calculated?">
            <p>{path.explanation}</p>
            <p className="mt-1">{path.tieBreak}</p>
            <p className="mt-1">This describes the chain of relationships, not a probability that anyone is reliable. The same number is used for task requirements and jury closeness.</p>
          </Why>
        </div>
      ) : null}
    </Card>
  );
}
