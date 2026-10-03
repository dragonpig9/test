import { useQuery } from '@tanstack/react-query';
import type { EmailOutboxView, ProfileUpdateInput, ProfileView, SkillClaimInput, SkillClaimView, SkillTierView } from '@commonhours/shared';
import { api } from '../../lib/api';

export const useProfile = (id?: string) => useQuery({ queryKey: ['profile', id], queryFn: () => api<{ profile: ProfileView }>(`/profiles/${id}`), enabled: !!id });
export const useSkills = (memberId?: string) =>
  useQuery({ queryKey: ['skills', memberId], queryFn: () => api<{ tiers: SkillTierView[]; claims: SkillClaimView[] }>(`/pricing/skills${memberId ? `?member=${memberId}` : ''}`) });
export const useReviewableClaims = () => useQuery({ queryKey: ['skills', 'reviewable'], queryFn: () => api<{ claims: SkillClaimView[] }>('/pricing/skills/reviewable') });
export const useOutbox = () => useQuery({ queryKey: ['outbox'], queryFn: () => api<{ emails: EmailOutboxView[] }>('/notifications/outbox') });

export const updateProfile = (b: ProfileUpdateInput) => api<{ profile: ProfileView }>('/profiles/me', { method: 'PUT', body: b });
export const requestEmailCode = () => api<{ sentTo: string; delivery: 'smtp' | 'preview' }>('/profiles/me/verify-email/request', { body: {} });
export const confirmEmailCode = (code: string) => api<{ profile: ProfileView }>('/profiles/me/verify-email/confirm', { body: { code } });
export const requestPhoneCode = () => api('/profiles/me/verify-phone/request', { body: {} });
export const claimSkill = (b: SkillClaimInput) => api('/pricing/skills', { body: b });
export const reviewSkill = (id: string, approve: boolean, note: string) => api(`/pricing/skills/${id}/review`, { body: { approve, note } });
