import clsx from 'clsx';
import { useRef, type KeyboardEvent } from 'react';
import { UNIVERSITIES, type UniversityCode } from '@commonhours/shared';

/**
 * Eight selectable university buttons (abbreviation + full name). Accessible as a radio group:
 * Tab focuses the group, arrow keys / Home / End move and select, Space/Enter select. Large touch
 * targets in a 2-column grid on phones, 4 columns from the sm breakpoint.
 */
export function UniversityPicker({ value, onChange, labelledBy }: { value: UniversityCode | null; onChange: (code: UniversityCode) => void; labelledBy: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, UNIVERSITIES.findIndex((u) => u.code === value));

  const move = (e: KeyboardEvent, i: number) => {
    const last = UNIVERSITIES.length - 1;
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const j = (next + UNIVERSITIES.length) % UNIVERSITIES.length;
    onChange(UNIVERSITIES[j].code);
    refs.current[j]?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {UNIVERSITIES.map((u, i) => {
        const selected = u.code === value;
        return (
          <button
            key={u.code}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tab index: one tab stop for the whole group.
            tabIndex={i === current ? 0 : -1}
            onClick={() => onChange(u.code)}
            onKeyDown={(e) => move(e, i)}
            className={clsx(
              'relative flex min-h-[4.25rem] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition',
              selected ? 'border-brand-700 bg-brand-50 ring-2 ring-brand-600' : 'border-slate-300 bg-white hover:border-brand-400 hover:bg-slate-50',
            )}
          >
            <span className={clsx('text-sm font-bold', selected ? 'text-brand-800' : 'text-slate-900')}>{u.code}</span>
            <span className="text-[11px] leading-tight text-slate-600">{u.name}</span>
            {selected && (
              <span aria-hidden className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand-700 text-[11px] text-white">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
