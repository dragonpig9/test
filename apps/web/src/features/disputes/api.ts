import { useQuery } from '@tanstack/react-query';
import type { DisputeView, MemberSummary, OpenDisputeInput } from '@commonhours/shared';
import { api } from '../../lib/api';

export interface DisputeRow {
  id: string;
  exchangeId: string;
  deliverable: string;
  provider: MemberSummary;
  recipient: MemberSummary;
  condition: string;
  status: string;
  stage: number;
  outcome: string | null;
  createdAt: string;
  myRole: 'party' | 'attestor' | 'observer';
  awaitingMyVote: boolean;
}

export const useDisputes = (scope: 'mine' | 'all') => useQuery({ queryKey: ['disputes', scope], queryFn: () => api<{ disputes: DisputeRow[] }>(`/disputes?scope=${scope}`) });
export const useDispute = (id?: string) => useQuery({ queryKey: ['dispute', id], queryFn: () => api<{ dispute: DisputeView }>(`/disputes/${id}`), enabled: !!id });
export const useConflicts = () => useQuery({ queryKey: ['conflicts'], queryFn: () => api<{ conflicts: { id: string; member: MemberSummary; other: MemberSummary; reason: string; createdAt: string }[] }>('/conflicts') });

export const openDispute = (b: OpenDisputeInput) => api<{ dispute: DisputeView }>('/disputes', { body: b });
export const addEvidence = (id: string, kind: string, content: string) => api(`/disputes/${id}/evidence`, { body: { kind, content } });
export const vote = (id: string, v: string, reason: string) => api(`/disputes/${id}/votes`, { body: { vote: v, reason } });
export const recuse = (id: string, reason: string) => api(`/disputes/${id}/recuse`, { body: { reason } });
export const retrySelection = (id: string) => api(`/disputes/${id}/retry-selection`, { body: {} });
export const proposeMutual = (id: string, outcome: 'CONFIRMED' | 'REFUTED') => api(`/disputes/${id}/mutual`, { body: { outcome } });
export const declareConflict = (otherMemberId: string, reason: string) => api('/conflicts', { body: { otherMemberId, reason } });
