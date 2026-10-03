import type { BadgeKind, BadgeView } from '@commonhours/shared';
import { MONTH_NAMES } from '../friends-activity/friends-activity.rules';

/**
 * Recognition badges (pure). Badges are labels only: nothing in the app reads them to decide credits,
 * prices, multipliers, spending limits, credibility, relationship strength, task access, invitations,
 * moderation or priority.
 */
export const BADGE_DEFINITIONS: Record<BadgeKind, { label: BadgeView['label']; description: string }> = {
  FIRST_EXCHANGE: { label: 'First Exchange', description: 'Completed a first settled exchange with another member.' },
  COMMUNITY_REGULAR: {
    label: 'Community Regular',
    description: 'Earned activity points on at least 3 different days with at least 2 different people in one month.',
  },
};

/** Community Regular: distinct Hong Kong days and distinct counterparties among the month's awarded points. */
export function communityRegularProgress(credited: { day: string; counterpartyId: string }[], rule: { minDays: number; minCounterparties: number }) {
  const days = new Set(credited.map((c) => c.day));
  const people = new Set(credited.map((c) => c.counterpartyId));
  return { days: days.size, counterparties: people.size, earned: days.size >= rule.minDays && people.size >= rule.minCounterparties };
}

export function monthPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function periodLabel(period: string): string | null {
  if (period === 'once') return null;
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function toBadgeView(b: { kind: string; period: string; awardedAt: Date }): BadgeView {
  const kind = b.kind as BadgeKind;
  return { kind, ...BADGE_DEFINITIONS[kind], period: b.period, periodLabel: periodLabel(b.period), awardedAt: b.awardedAt.toISOString() };
}
