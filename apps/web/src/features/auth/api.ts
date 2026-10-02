import type { InvitationView, JoinInput, LoginInput, MemberProfile } from '@commonhours/shared';
import { api } from '../../lib/api';

export const login = (b: LoginInput) => api<{ token: string; member: MemberProfile }>('/auth/login', { body: b });
export const join = (b: JoinInput) => api<{ token: string; member: MemberProfile }>('/auth/join', { body: b });
export const previewInvitation = (code: string) => api<{ invitation: InvitationView }>(`/invitations/code/${encodeURIComponent(code)}`);
