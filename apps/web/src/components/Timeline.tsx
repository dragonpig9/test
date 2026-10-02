import type { TimelineEntry } from '@commonhours/shared';
import { fmtDate } from '../lib/format';
import { Empty } from './ui';

const DOT: Record<string, string> = {
  exchanges: 'bg-sky-500',
  ledger: 'bg-brand-600',
  attestation: 'bg-amber-500',
  credibility: 'bg-violet-500',
  vouches: 'bg-teal-500',
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return <Empty title="No events yet" />;
  return (
    <ol className="relative ml-2 border-l border-slate-200">
      {entries.map((e) => (
        <li key={e.id} className="mb-4 ml-4">
          <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${DOT[e.module] ?? 'bg-slate-400'}`} aria-hidden />
          <p className="text-sm text-slate-900">{e.summary}</p>
          <p className="text-xs text-slate-500">
            {fmtDate(e.at)} · {e.actor ?? 'system'} · <span className="font-mono">{e.action}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}
