import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from './api';

/**
 * Mutation helper: after any successful write we refetch everything, so the UI always
 * shows the backend's current decisions (balances, statuses, scores) rather than guessing.
 */
export function useAction<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, onSuccess?: (r: TRes) => void) {
  const qc = useQueryClient();
  return useMutation<TRes, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      onSuccess?.(r);
    },
  });
}
