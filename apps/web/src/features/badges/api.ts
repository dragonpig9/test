import { useQuery } from '@tanstack/react-query';
import type { MyBadgesView } from '@commonhours/shared';
import { api } from '../../lib/api';

export const useMyBadges = () => useQuery({ queryKey: ['badges', 'me'], queryFn: () => api<MyBadgesView>('/badges/me') });
export const setBadgeVisibility = (showBadges: boolean) => api<MyBadgesView>('/badges/me/visibility', { method: 'PUT', body: { showBadges } });
