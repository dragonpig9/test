import { Link } from 'react-router-dom';
import type { MemberSummary } from '@commonhours/shared';
import { useQuery } from '@tanstack/react-query';
import type { MemberProfile as Profile } from '@commonhours/shared';
import { Card, Loading } from '../../components/ui';
import { Avatar } from '../../components/MemberChip';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useMemberCredibility } from './api';

export function MemberProfilePanel({ member }: { member: MemberSummary }) {
  const profile = useQuery({ queryKey: ['member', member.id], queryFn: () => api<{ member: Profile }>(`/members/${member.id}`) });
  const cred = useMemberCredibility(member.id);
  const p = profile.data?.member;
  return (
    <Card title="Member profile">
      <div className="flex items-center gap-3">
        <Avatar m={member} size="lg" />
        <div>
          <p className="text-base font-semibold">{member.displayName}</p>
          <p className="text-xs text-slate-500">
            @{member.handle}
            {member.isBootstrap && ' · bootstrap member (founded the community without a voucher)'}
            {member.status === 'LEFT' && ' · has left'}
          </p>
        </div>
      </div>
      {profile.isLoading ? (
        <Loading />
      ) : (
        p && (
          <div className="mt-3 space-y-2 text-sm">
            {p.bio && <p className="text-slate-700">{p.bio}</p>}
            {p.skills.length > 0 && (
              <p className="flex flex-wrap gap-1">
                {p.skills.map((s) => (
                  <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    {s}
                  </span>
                ))}
              </p>
            )}
            <p className="text-xs text-slate-500">Member since {fmtDate(p.joinedAt, false)}. Skills are self-described; nobody here verifies professional qualifications.</p>
          </div>
        )
      )}
      {cred.data && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
          <p>
            Credibility <span className="font-semibold num">{cred.data.score}</span>{' '}
            <Link className="text-xs font-medium text-brand-700 hover:underline" to={`/credibility?member=${member.id}`}>
              see calculation
            </Link>
          </p>
          <ul className="mt-1 text-xs text-slate-600">
            {cred.data.factors.map((f) => (
              <li key={f.key}>
                {f.label}: {f.points}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link to={`/services?owner=${member.id}`} className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
        View their listings →
      </Link>
    </Card>
  );
}
