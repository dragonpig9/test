import { useQuery } from '@tanstack/react-query';
import type { DemoReadinessView, DemoWalkthroughView } from '@commonhours/shared';
import { api, type ApiError } from '../../../lib/api';

/** Codes the server answers with while the shared demo is being prepared, or after preparation failed. */
export const isDemoNotReady = (e: unknown) => ['DEMO_PREPARING', 'DEMO_FAILED'].includes((e as ApiError | null)?.code ?? '');

/** Read-only walkthrough state. Opening or restarting /demo never changes data. */
export const useWalkthrough = (enabled = true) =>
  useQuery({
    queryKey: ['demo', 'walkthrough'],
    queryFn: () => api<DemoWalkthroughView>('/demo/walkthrough'),
    enabled,
    // Not-ready answers are handled by polling readiness, not by retrying the heavy view.
    retry: (n, e) => n < 1 && !isDemoNotReady(e),
  });

/** While preparing: poll every few seconds, at most this many times (about two minutes) before asking to retry. */
export const PREPARING_POLL_MS = 2500;
export const MAX_PREPARING_POLLS = 48;
/** While ready: a light poll (one row) notices within seconds when someone resets the shared demo. */
export const READY_POLL_MS = 5_000;

export const useDemoReadiness = (enabled: boolean, pollMs: (status?: DemoReadinessView['status']) => number | false) =>
  useQuery({
    queryKey: ['demo', 'readiness'],
    queryFn: () => api<DemoReadinessView>('/demo/readiness'),
    enabled,
    refetchInterval: (q) => pollMs(q.state.data?.status),
    retry: 1,
  });

export const CHAPTERS = [
  { n: 1, short: 'Trust', title: 'Find help and understand trust' },
  { n: 2, short: 'Exchange', title: 'Agree, reserve and complete' },
  { n: 3, short: 'Pricing', title: 'Understand skill and demand pricing' },
  { n: 4, short: 'Dispute', title: 'Resolve a dispute' },
  { n: 5, short: 'Results', title: 'See the results' },
] as const;
