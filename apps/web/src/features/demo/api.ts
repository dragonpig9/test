import { useQuery } from '@tanstack/react-query';
import type { DailyJobRunView, DemoGuideStep, MemberProfile } from '@commonhours/shared';
import { api } from '../../lib/api';

export interface DemoState {
  demoMode: boolean;
  now: string;
  simulated: boolean;
  seededAt: string | null;
  members: MemberProfile[];
  guide: DemoGuideStep[];
  extras: { title: string; instruction: string }[];
  devShortcuts: boolean;
  nextDailyRunAt: string;
}

export const useDemoState = (enabled = true) => useQuery({ queryKey: ['demo'], queryFn: () => api<DemoState>('/demo/state'), enabled, retry: false });
export const switchAccount = (handle: string) => api<{ token: string }>('/demo/switch', { body: { handle } });
export const resetDemo = () => api<{ ok: true }>('/demo/reset', { body: {} });
type ClockResult = { now: string; expiredCredits: { name: string; amount: number }[]; expiredVouches: number; disputesNeedingReview: number; reminders?: number; dailyJobs: DailyJobRunView[] };
export const advanceClock = (days: number) => api<ClockResult>('/demo/clock/advance', { body: { days } });
/** Development only. */
export const toNextDailyRun = () => api<ClockResult>('/demo/clock/next-daily-run', { body: {} });
/** Development only. Idempotent: an already completed run is returned, not repeated. */
export const runDailyJobNow = () => api<{ ran: boolean; run: DailyJobRunView }>('/demo/daily-job/run', { body: {} });
