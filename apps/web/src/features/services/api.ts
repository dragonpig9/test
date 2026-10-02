import { useQuery } from '@tanstack/react-query';
import type { CreateListingInput, ListingView } from '@commonhours/shared';
import { api } from '../../lib/api';

export interface ListingFilters {
  category: string;
  type: '' | 'OFFER' | 'REQUEST';
  reachableOnly: boolean;
  mine: boolean;
  owner?: string;
}

export const useListings = (f: ListingFilters) => {
  const q = new URLSearchParams({ category: f.category, type: f.type, reachableOnly: String(f.reachableOnly), mine: String(f.mine), ...(f.owner ? { owner: f.owner } : {}) });
  return useQuery({ queryKey: ['listings', f], queryFn: () => api<{ listings: ListingView[]; categories: string[] }>(`/listings?${q}`) });
};
export const createListing = (b: CreateListingInput) => api<{ listing: ListingView }>('/listings', { body: b });
export const withdrawListing = (id: string) => api(`/listings/${id}/withdraw`, { body: {} });
