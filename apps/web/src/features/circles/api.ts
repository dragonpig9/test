import { useQuery } from '@tanstack/react-query';
import type { CircleMessageInput, CircleMessageView, CircleRoomView, ListingView, MyCircleView } from '@commonhours/shared';
import { api } from '../../lib/api';

export const useMyCircle = () => useQuery({ queryKey: ['circles', 'me'], queryFn: () => api<MyCircleView>('/circles/me') });
export const useCircleRoom = (code: string | undefined, tag: string | null) =>
  useQuery({
    queryKey: ['circles', code, 'messages', tag],
    queryFn: () => api<CircleRoomView>(`/circles/${encodeURIComponent(code!)}/messages${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`),
    enabled: !!code,
    refetchInterval: 15_000,
  });
export const useCircleBoard = (code: string | undefined, tag: string | null) =>
  useQuery({
    queryKey: ['circles', code, 'board', tag],
    queryFn: () => api<{ listings: ListingView[] }>(`/circles/${encodeURIComponent(code!)}/board${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`),
    enabled: !!code,
  });
export const postCircleMessage = (code: string, b: CircleMessageInput) => api<{ message: CircleMessageView }>(`/circles/${encodeURIComponent(code)}/messages`, { body: b });
