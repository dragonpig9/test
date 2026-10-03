import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { universityByCode, type FriendsActivityView } from '@commonhours/shared';
import { Avatar } from '../../components/MemberChip';
import { Card, Empty, ErrorBox, Loading, Why } from '../../components/ui';
import { api } from '../../lib/api';
import { credits } from '../../lib/format';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Query key starts with 'friends-activity' and is refetched by useAction after every write (e.g. confirming an exchange).
const useFriendsActivity = (sel: { year: number; month: number } | null) =>
  useQuery({
    queryKey: ['friends-activity', sel?.year ?? 'current', sel?.month ?? 'current'],
    queryFn: () => api<FriendsActivityView>(`/friends-activity${sel ? `?year=${sel.year}&month=${sel.month}` : ''}`),
  });

/**
 * Friends activity: you and your accepted direct friends for one Hong Kong calendar month, ranked by
 * capped activity points, with credits earned and spent beside the score. Display only: choosing a
 * month never changes balances, eligibility or the pool.
 */
export function FriendsActivityCard() {
  const [sel, setSel] = useState<{ year: number; month: number } | null>(null); // null = current month (server clock)
  const q = useFriendsActivity(sel);
  const v = q.data;
  const pick = (year: number, month: number) => setSel({ year, month });
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          Friends activity
          {v && (
            <span className="cursor-help text-sm font-normal text-slate-400" title={v.rules.join('\n')} aria-label="How points work">
              ⓘ
            </span>
          )}
        </span>
      }
    >
      {v && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="fa-month">
            Month
          </label>
          <select id="fa-month" className="input w-auto py-1" value={v.month} onChange={(e) => pick(v.year, Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="fa-year">
            Year
          </label>
          <select id="fa-year" className="input w-auto py-1" value={v.year} onChange={(e) => pick(Number(e.target.value), v.month)}>
            {v.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {!v.isCurrentMonth && (
            <button type="button" className="text-xs font-medium text-brand-700 underline" onClick={() => setSel(null)}>
              This month
            </button>
          )}
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} title="Could not load Friends activity" />
      ) : v && v.entries.length > 1 ? (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {v.monthName} {v.year} · Hong Kong time
          </p>
          <ol className="divide-y divide-slate-100">
            {v.entries.map((e) => (
              <li key={e.member.id} className={clsx('flex items-center gap-3 px-2 py-2', e.isMe && 'rounded-lg bg-brand-50 ring-1 ring-brand-200')} aria-current={e.isMe ? 'true' : undefined}>
                <span className={clsx('num w-6 text-center text-sm font-semibold', e.rank === 1 ? 'text-amber-600' : 'text-slate-500')}>{e.rank}</span>
                <Avatar m={e.member} />
                <div className="min-w-0 flex-1">
                  <Link to={`/profile/${e.member.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700">
                    {e.member.displayName}
                    {e.isMe && <span className="ml-1.5 rounded bg-brand-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">You</span>}
                  </Link>
                  <span className="block truncate text-xs text-slate-500">
                    {e.university ? `${universityByCode(e.university)?.code ?? e.university} · ` : ''}earned {credits(e.creditsEarned)} · spent {credits(e.creditsSpent)}
                  </span>
                </div>
                <span className="num text-right text-sm">
                  <span className="font-semibold text-slate-900">{e.points}</span>
                  <span className="ml-1 text-xs text-slate-500">pt{e.points === 1 ? '' : 's'}</span>
                </span>
              </li>
            ))}
          </ol>
          <Why label="How are points counted?">
            <ul className="list-disc space-y-1 pl-4">
              {v.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Why>
        </>
      ) : (
        <Empty title="No friends here yet">Accepted vouches and exchanges both members confirmed make someone a friend.</Empty>
      )}
    </Card>
  );
}
