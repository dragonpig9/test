import { useQuery } from '@tanstack/react-query';
import type { StudentDetailsInput, StudentStatusView } from '@commonhours/shared';
import { api } from '../../lib/api';

export const useStudentStatus = () => useQuery({ queryKey: ['student', 'me'], queryFn: () => api<{ student: StudentStatusView }>('/students/me') });
export const saveStudentDetails = (b: StudentDetailsInput) => api<{ student: StudentStatusView; verificationReset: boolean }>('/students/me', { method: 'PUT', body: b });
export const requestStudentCode = () => api<{ sentTo: string; delivery: 'smtp' | 'preview' }>('/students/me/verify/request', { body: {} });
export const confirmStudentCode = (code: string) => api<{ student: StudentStatusView }>('/students/me/verify/confirm', { body: { code } });
