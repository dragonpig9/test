import { useQuery } from '@tanstack/react-query';
import type { ExchangeTermsInput, ExchangeView, PathResult, ProposeExchangeInput, TimelineEntry } from '@commonhours/shared';
import { api } from '../../lib/api';

export interface ExchangeDetail {
  exchange: ExchangeView;
  trustPath: PathResult;
  timeline: TimelineEntry[];
  liabilitySnapshot: { vouchId: string; voucherId: string; voucheeId: string; strength: number; liabilityPct: number }[] | null;
}

export const useExchanges = () => useQuery({ queryKey: ['exchanges'], queryFn: () => api<{ exchanges: ExchangeView[] }>('/exchanges') });
export const useExchange = (id?: string) => useQuery({ queryKey: ['exchange', id], queryFn: () => api<ExchangeDetail>(`/exchanges/${id}`), enabled: !!id });

export const proposeExchange = (b: ProposeExchangeInput) => api<{ exchange: ExchangeView }>('/exchanges', { body: b });
export const updateTerms = (id: string, b: ExchangeTermsInput) => api<{ exchange: ExchangeView }>(`/exchanges/${id}/terms`, { method: 'PUT', body: b });
export const acceptExchange = (id: string, termsVersion: number) => api(`/exchanges/${id}/accept`, { body: { termsVersion } });
export const declineExchange = (id: string) => api(`/exchanges/${id}/decline`, { body: {} });
export const confirmExchange = (id: string) => api(`/exchanges/${id}/confirm`, { body: {} });
export const cancelExchange = (id: string, reason: string) => api(`/exchanges/${id}/cancel`, { body: { reason } });
export const proposePartial = (id: string, amount: number, note: string) => api(`/exchanges/${id}/partial`, { body: { amount, note } });
export const acceptPartial = (id: string) => api(`/exchanges/${id}/partial/accept`, { body: {} });
