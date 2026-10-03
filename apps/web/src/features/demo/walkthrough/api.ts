import { useQuery } from '@tanstack/react-query';
import type { DemoWalkthroughView } from '@commonhours/shared';
import { api } from '../../../lib/api';

/** Read-only walkthrough state. Opening or restarting /demo never changes data. */
export const useWalkthrough = (enabled = true) =>
  useQuery({ queryKey: ['demo', 'walkthrough'], queryFn: () => api<DemoWalkthroughView>('/demo/walkthrough'), enabled, retry: 1 });

export const CHAPTERS = [
  { n: 1, short: 'Trust', title: 'Find help and understand trust' },
  { n: 2, short: 'Exchange', title: 'Agree, reserve and complete' },
  { n: 3, short: 'Pricing', title: 'Understand skill and demand pricing' },
  { n: 4, short: 'Dispute', title: 'Resolve a dispute' },
  { n: 5, short: 'Results', title: 'See the results' },
] as const;
