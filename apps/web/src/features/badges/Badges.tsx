import type { BadgeView } from '@commonhours/shared';
import { Card, ErrorBox, Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { setBadgeVisibility, useMyBadges } from './api';

const ICON: Record<BadgeView['kind'], string> = { FIRST_EXCHANGE: '🤝', COMMUNITY_REGULAR: '🌱' };

/** Badge chips on a profile. Recognition only. */
export function BadgeShelf({ badges }: { badges: BadgeView[] }) {
  if (!badges.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Badges">
      {badges.map((b) => (
        <li key={`${b.kind}:${b.period}`} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900" title={`${b.description} Awarded ${fmtDate(b.awardedAt, false)}.`}>
          <span aria-hidden>{ICON[b.kind]}</span>
          {b.label}
          {b.periodLabel && <span className="font-normal">· {b.periodLabel}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Own profile: your badges and whether others can see them. */
export function MyBadgesCard() {
  const q = useMyBadges();
  const toggle = useAction((show: boolean) => setBadgeVisibility(show));
  const v = q.data;
  return (
    <Card title="Badges">
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        v && (
          <div className="space-y-3 text-sm">
            {v.badges.length ? <BadgeShelf badges={v.badges} /> : <p className="text-slate-600">No badges yet.</p>}
            <ul className="space-y-1 text-xs text-slate-600">
              {v.definitions.map((d) => (
                <li key={d.kind}>
                  <span className="font-medium">{d.label}:</span> {d.description}
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={v.showBadges} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} />
              Show my badges on my profile
            </label>
            <ErrorBox error={toggle.error} />
            <p className="text-xs text-slate-500">{v.note}</p>
          </div>
        )
      )}
    </Card>
  );
}

/** A small celebration on the overview for badges earned in the last few days (simulated clock). */
export function BadgeCelebration() {
  const { me } = useAuth();
  const q = useMyBadges();
  if (!me || !q.data) return null;
  const recent = q.data.badges.filter((b) => new Date(me.now).getTime() - new Date(b.awardedAt).getTime() < 3 * 86_400_000);
  if (!recent.length) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950" role="status">
      <span className="text-2xl" aria-hidden>
        🎉
      </span>
      <span>
        New badge{recent.length > 1 ? 's' : ''}: <strong>{recent.map((b) => b.label + (b.periodLabel ? ` (${b.periodLabel})` : '')).join(', ')}</strong>. Thanks for helping your community.
      </span>
    </div>
  );
}
