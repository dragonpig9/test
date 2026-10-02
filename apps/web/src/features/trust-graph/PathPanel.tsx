import type { PathResult } from '@commonhours/shared';
import { Card, Empty, ErrorBox, Loading, Why } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';

export function PathPanel({ path, loading, error, ready }: { path?: PathResult; loading: boolean; error: unknown; ready: boolean }) {
  return (
    <Card title="Trust path">
      {!ready ? (
        <Empty title="Select two members">Click a member in the graph (from), then another (to), or use the pickers above.</Empty>
      ) : loading ? (
        <Loading label="Finding the shortest active path…" />
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
            <p className="text-sm text-slate-600">connection strength · {path.hops} hop(s)</p>
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
                  <span className="ml-auto font-mono text-xs">× {s.edge.effectiveStrength}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {s.forward ? `${s.from.displayName} vouched for ${s.to.displayName}` : `${s.to.displayName} vouched for ${s.from.displayName} (walked backwards — not an endorsement by ${s.from.displayName})`} ·{' '}
                  {s.edge.ageDays} days old · {s.edge.explanation}
                </p>
              </li>
            ))}
          </ol>
          <Why label="How is this calculated?">
            <p>{path.explanation}</p>
            <p className="mt-1">{path.tieBreak}</p>
            <p className="mt-1">This is a description of the vouch chain, not a probability that anyone is reliable.</p>
          </Why>
        </div>
      ) : null}
    </Card>
  );
}
