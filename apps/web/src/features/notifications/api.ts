import { useQuery } from '@tanstack/react-query';
import type { NotificationCategory, NotificationPreferences, NotificationView } from '@commonhours/shared';
import { api } from '../../lib/api';

/** Persisted on the server, so they survive a page refresh. The unread count polls every 30 s. */
export const useNotifications = (opts: { unread?: boolean; limit?: number } = {}) =>
  useQuery({
    queryKey: ['notifications', opts],
    queryFn: () => api<{ notifications: NotificationView[]; unread: number }>(`/notifications?limit=${opts.limit ?? 50}${opts.unread ? '&unread=true' : ''}`),
  });
export const useUnreadCount = () => useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api<{ unread: number }>('/notifications/unread-count'), refetchInterval: 30_000 });
export const usePreferences = () => useQuery({ queryKey: ['notifications', 'preferences'], queryFn: () => api<NotificationPreferences>('/notifications/preferences') });

export const markRead = (id: string) => api(`/notifications/${id}/read`, { body: {} });
export const markAllRead = () => api('/notifications/read-all', { body: {} });
export const savePreferences = (emailEnabled: boolean, categories: NotificationCategory[]) => api<NotificationPreferences>('/notifications/preferences', { method: 'PUT', body: { emailEnabled, categories } });
