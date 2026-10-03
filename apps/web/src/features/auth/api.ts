import { useQuery } from '@tanstack/react-query';
import type { InvitationView, JoinInput, LoginInput, MemberProfile, StudentJoinInput } from '@commonhours/shared';
import { api } from '../../lib/api';

/** What both join routes return after the account is created. `notice` never claims an email was sent when it was not. */
export interface JoinResult {
  token: string;
  member: MemberProfile;
  demoAdmitted: boolean;
  studentVerification: { sentTo: string; delivery: string } | null;
  notice: string | null;
}

/** Public server configuration (GET /api/health). demoMode is the server's DEMO_MODE; the browser cannot change it. */
export const usePublicConfig = () =>
  useQuery({ queryKey: ['public-config'], queryFn: () => api<{ demoMode: boolean; demo: { enabled: boolean; bypasses: string[] } }>('/health'), staleTime: 60_000 });
export const studentTerms = () => api<{ terms: string[] }>('/auth/join/student/terms');
export const joinAsStudent = (b: StudentJoinInput) => api<JoinResult>('/auth/join/student', { body: b });

export const login = (b: LoginInput) => api<{ token: string; member: MemberProfile }>('/auth/login', { body: b });
export const join = (b: JoinInput) => api<JoinResult>('/auth/join', { body: b });
export const previewInvitation = (code: string) => api<{ invitation: InvitationView }>(`/invitations/code/${encodeURIComponent(code)}`);
