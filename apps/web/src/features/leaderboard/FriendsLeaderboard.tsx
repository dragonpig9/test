import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { universityByCode, type LeaderboardView } from '@commonhours/shared';
import { Avatar } from '../../components/MemberChip';
import { Card, Empty, ErrorBox, Loading, Why } from '../../components/ui';
import { api } from '../../lib/api';

// Query key ['leaderboard'] is refetched by useAction after every write (e.g. confirming an exchange).
export const useLeaderboard = () => useQuery({ queryKey: ['leaderboard'], queryFn: () => api<LeaderboardView>('/activity/leaderboard') });

/** 好友活躍排行榜 — you and your accepted direct friends, ranked by activity points. */
export function FriendsLeaderboard() {
  const q = useLeaderboard();
  const lb = q.data;
  return (
    <Card title={<span>好友活躍排行榜 <span className="text-sm font-normal text-slate-500">· Friends activity</span></span>}>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} title="Could not load the leaderboard" />
      ) : lb && lb.entries.length > 1 ? (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {lb.window.startDay} → {lb.window.endDay} (Hong Kong time)
          </p>
          <ol className="divide-y divide-slate-100">
            {lb.entries.map((e) => (
              <li key={e.member.id} className={clsx('flex items-center gap-3 px-2 py-2', e.isMe && 'rounded-lg bg-brand-50 ring-1 ring-brand-200')} aria-current={e.isMe ? 'true' : undefined}>
                <span className={clsx('num w-6 text-center text-sm font-semibold', e.rank === 1 ? 'text-amber-600' : 'text-slate-500')}>{e.rank}</span>
                <Avatar m={e.member} />
                <div className="min-w-0 flex-1">
                  <Link to={`/profile/${e.member.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700">
                    {e.member.displayName}
                    {e.isMe && <span className="ml-1.5 rounded bg-brand-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">You</span>}
                  </Link>
                  {e.university && <span className="block truncate text-xs text-slate-500">{universityByCode(e.university)?.code ?? e.university}</span>}
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
              {lb.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Why>
        </>
      ) : (
        <Empty title="No friends on the board yet">Accepted vouches and exchanges both members confirmed make someone a friend here.</Empty>
      )}
    </Card>
  );
}
