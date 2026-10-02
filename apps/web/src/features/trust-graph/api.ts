import { useQuery } from '@tanstack/react-query';
import type { CredibilityView, GraphView, PathResult } from '@commonhours/shared';
import { api } from '../../lib/api';

export const useGraph = () => useQuery({ queryKey: ['trust', 'graph'], queryFn: () => api<GraphView>('/trust/graph') });
export const usePath = (from?: string, to?: string) =>
  useQuery({ queryKey: ['trust', 'path', from, to], queryFn: () => api<PathResult>(`/trust/path?from=${from}&to=${to}`), enabled: !!from && !!to && from !== to });
export const useMemberCredibility = (id?: string) => useQuery({ queryKey: ['credibility', id], queryFn: () => api<CredibilityView>(`/credibility/${id}`), enabled: !!id });
