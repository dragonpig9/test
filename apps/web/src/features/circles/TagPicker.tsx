import clsx from 'clsx';
import { TOPIC_TAGS } from '@commonhours/shared';

/** Topic tag chips (Coding, Tutoring, Language practice, Moving and practical help). Discovery only. */
export function TagPicker({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {TOPIC_TAGS.map((t) => {
        const on = value.includes(t);
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])}
            className={clsx('rounded-full border px-2.5 py-0.5 text-xs font-medium', on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}
          >
            #{t}
          </button>
        );
      })}
    </div>
  );
}

/** Single-select filter version: one tag or all. */
export function TagFilter({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div role="radiogroup" aria-label="Filter by topic" className="flex flex-wrap gap-1.5">
      {[null, ...TOPIC_TAGS].map((t) => (
        <button
          key={t ?? 'all'}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(t)}
          className={clsx('rounded-full border px-2.5 py-0.5 text-xs font-medium', value === t ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}
        >
          {t ? `#${t}` : 'All topics'}
        </button>
      ))}
    </div>
  );
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
          #{t}
        </span>
      ))}
    </span>
  );
}
