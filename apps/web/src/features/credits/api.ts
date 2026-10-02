import { useQuery } from '@tanstack/react-query';
import type { CreditSummary, LedgerEntryView } from '@commonhours/shared';
import { api } from '../../lib/api';

export const useCreditSummary = () => useQuery({ queryKey: ['credits'], queryFn: () => api<CreditSummary>('/credits/summary') });
export const useLedgerEntries = () => useQuery({ queryKey: ['credits', 'entries'], queryFn: () => api<{ entries: LedgerEntryView[] }>('/credits/entries') });
