/**
 * Credits are stored as integers in hundredths of a credit so that
 * 1h30 = 150 units and no floating point rounding enters the ledger.
 * 1 credit = 1 hour of service (the default time-bank price).
 */
export const CREDIT_SCALE = 100;

export const SERVICE_CATEGORIES = [
  'Tutoring',
  'Cooking',
  'Translation',
  'Design',
  'Equipment repair',
  'Gardening',
  'Other',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/**
 * Lightweight topic tags for circle messages, requests and offers. Used for discovery only:
 * they never change prices, eligibility, trust or credits.
 */
export const TOPIC_TAGS = ['Coding', 'Tutoring', 'Language practice', 'Moving and practical help'] as const;
export type TopicTag = (typeof TOPIC_TAGS)[number];

export const VOUCH_STRENGTHS = [0.4, 0.7, 1.0] as const;
export const LIABILITY_OPTIONS = [10, 20, 30] as const;

/** Formats hundredths of a credit as a human string, e.g. 150 -> "1.5". */
export function formatCredits(units: number): string {
  const v = units / CREDIT_SCALE;
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2).replace(/0$/, '');
}

/** Converts minutes of service into credit units at the standard 1h = 1 credit rate. */
export function minutesToCreditUnits(minutes: number): number {
  return Math.round((minutes / 60) * CREDIT_SCALE);
}
