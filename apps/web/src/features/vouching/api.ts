import { useQuery } from '@tanstack/react-query';
import type { EdgeView, InvitationView, MemberSummary, VouchAmendmentView } from '@commonhours/shared';
import { api } from '../../lib/api';

export interface MyVouch extends EdgeView {
  voucher: MemberSummary;
  vouchee: MemberSummary;
  direction: 'outgoing' | 'incoming';
  origin: string;
  endReason: string | null;
  terms: string[];
  amendments: VouchAmendmentView[];
}

export const useMyVouches = () => useQuery({ queryKey: ['vouches'], queryFn: () => api<{ limit: number; used: number; vouches: MyVouch[] }>('/vouches') });
export const useInvitations = () => useQuery({ queryKey: ['invitations'], queryFn: () => api<{ invitations: InvitationView[] }>('/invitations') });
export const useVouchTerms = (strength: number, liabilityPct: number) =>
  useQuery({ queryKey: ['vouch-terms', strength, liabilityPct], queryFn: () => api<{ terms: string[]; maxPenaltyPoints: number }>(`/vouches/terms?strength=${strength}&liabilityPct=${liabilityPct}`) });

export const proposeVouch = (b: { voucheeId: string; strength: number; liabilityPct: number }) => api('/vouches', { body: { ...b, acknowledgeLiability: true } });
export const respondVouch = (id: string, accept: boolean) => api(`/vouches/${id}/${accept ? 'accept' : 'decline'}`, { body: {} });
export const revokeVouch = (id: string, reason: string) => api(`/vouches/${id}/revoke`, { body: { reason } });
export const amendVouch = (id: string, b: { strength: number; liabilityPct: number }) => api(`/vouches/${id}/amendments`, { body: b });
export const respondAmendment = (id: string, accept: boolean) => api(`/vouches/amendments/${id}/${accept ? 'accept' : 'decline'}`, { body: {} });
export const createInvitation = (b: { inviteeName: string; strength: number; liabilityPct: number }) => api<{ invitation: InvitationView }>('/invitations', { body: { ...b, acknowledgeLiability: true } });
export const revokeInvitation = (id: string) => api(`/invitations/${id}/revoke`, { body: {} });
