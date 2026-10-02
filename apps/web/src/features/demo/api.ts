import { useQuery } from '@tanstack/react-query';
import type { DemoGuideStep, MemberProfile } from '@commonhours/shared';
import { api } from '../../lib/api';

export interface DemoState {
  demoMode: boolean;
  now: string;
  simulated: boolean;
  seededAt: string | null;
  members: MemberProfile[];
  guide: DemoGuideStep[];
  extras: { title: string; instruction: string }[];
}

export const useDemoState = (enabled = true) => useQuery({ queryKey: ['demo'], queryFn: () => api<DemoState>('/demo/state'), enabled, retry: false });
export const switchAccount = (handle: string) => api<{ token: string }>('/demo/switch', { body: { handle } });
export const resetDemo = () => api<{ ok: true }>('/demo/reset', { body: {} });
export const advanceClock = (days: number) => api<{ now: string; expiredCredits: { name: string; amount: number }[]; expiredVouches: number; disputesNeedingReview: number }>('/demo/clock/advance', { body: { days } });
