import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SERVICE_CATEGORIES, type ListingView, type ServiceCategory } from '@commonhours/shared';
import { Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, StatusChip } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { useAuth } from '../../lib/auth';
import { duration } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { TermsForm } from '../exchanges/TermsForm';
import { useListings, withdrawListing, type ListingFilters } from './api';
import { NewListingForm } from './NewListingForm';

export function ServiceBoardPage() {
  const { me } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState<ListingFilters>({ category: '', type: '', reachableOnly: false, mine: false, owner: params.get('owner') ?? undefined });
  const listings = useListings(f);
  const [creating, setCreating] = useState(false);
  const [proposing, setProposing] = useState<ListingView | null>(null);
  const withdraw = useAction((id: string) => withdrawListing(id));
  return (
    <div>
      <PageHeader
        title="Service Board"
        subtitle="Offers and requests from members. A listing is only an advert — agreeing terms creates a separate exchange record. Every hour is worth one credit."
        actions={<Button onClick={() => setCreating(true)} disabled={me?.member.status === 'LEFT'}>New listing</Button>}
      />
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="label">Category</span>
            <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="">All categories</option>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="label">Type</span>
            <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ListingFilters['type'] })}>
              <option value="">Offers and requests</option>
              <option value="OFFER">Offers</option>
              <option value="REQUEST">Requests</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={f.reachableOnly} onChange={(e) => setF({ ...f, reachableOnly: e.target.checked })} />
            Reachable through my active network only
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} />
            My listings
          </label>
          {f.owner && (
            <button type="button" className="pb-2 text-sm text-brand-700 underline" onClick={() => setF({ ...f, owner: undefined })}>
              Clear member filter
            </button>
          )}
        </div>
      </Card>
      <ErrorBox error={withdraw.error} />
      {listings.isLoading ? (
        <Loading />
      ) : listings.error ? (
        <ErrorBox error={listings.error} title="Could not load listings" />
      ) : !listings.data?.listings.length ? (
        <Empty title="No listings match these filters">Try another category or turn off “reachable only”.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {listings.data.listings.map((l) => {
            const mine = l.owner.id === me?.member.id;
            return (
              <article key={l.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <StatusChip status={l.type === 'OFFER' ? 'ACCEPTED' : 'PROPOSED'} label={l.type === 'OFFER' ? 'Offer' : 'Request'} />
                  <span className="text-xs text-slate-500">{l.category}</span>
                </div>
                <h2 className="mt-2 text-base">{l.title}</h2>
                <p className="mt-1 line-clamp-3 text-sm text-slate-600">{l.description}</p>
                <dl className="mt-3 space-y-1 text-xs text-slate-600">
                  <div>
                    <dt className="inline font-medium">Duration: </dt>
                    <dd className="inline">
                      {duration(l.durationMinutes)} = {l.durationMinutes / 60} credit(s)
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Where: </dt>
                    <dd className="inline">{l.locationType === 'ONLINE' ? 'Online' : l.location || 'In person'}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Availability: </dt>
                    <dd className="inline">{l.availability}</dd>
                  </div>
                  {l.requiredSkills.length > 0 && (
                    <div>
                      <dt className="inline font-medium">Skills: </dt>
                      <dd className="inline">{l.requiredSkills.join(', ')}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <MemberChip m={l.owner} suffix={l.type === 'OFFER' ? 'provides' : 'requests'} />
                  <span className="text-right text-xs">
                    {mine ? (
                      <span className="text-slate-500">your listing</span>
                    ) : l.reachability?.reachable ? (
                      <span className="text-teal-700">
                        {l.reachability.hops} hop(s) · strength {l.reachability.strength}
                      </span>
                    ) : (
                      <span className="text-amber-700">not reachable via active vouches</span>
                    )}
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  {mine ? (
                    <Button variant="danger" onClick={() => window.confirm('Remove this listing? Existing exchanges are not affected.') && withdraw.mutate(l.id)}>
                      Remove listing
                    </Button>
                  ) : (
                    <Button onClick={() => setProposing(l)} disabled={me?.member.status === 'LEFT'}>
                      {l.type === 'OFFER' ? 'Request this service' : 'Offer to help'}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New listing" wide>
        <NewListingForm onDone={() => setCreating(false)} />
      </Modal>
      {proposing && (
        <Modal open onClose={() => setProposing(null)} title={`Agree terms with ${proposing.owner.displayName}`} wide>
          <TermsForm
            mode="propose"
            myRole={proposing.type === 'OFFER' ? 'recipient' : 'provider'}
            counterpartyId={proposing.owner.id}
            counterpartyName={proposing.owner.displayName}
            listingId={proposing.id}
            init={{
              deliverable: proposing.title,
              category: proposing.category as ServiceCategory,
              durationMinutes: proposing.durationMinutes,
              location: proposing.locationType === 'ONLINE' ? 'Online' : proposing.location,
              punctualityRequired: false,
              giftBonus: 0,
              cancellationNoticeHours: 1,
              cancellationTerms: 'Free cancellation up to the notice period; later only by agreement.',
              confirmationDays: 3,
            }}
            onDone={(id) => nav(`/exchanges/${id}`)}
          />
        </Modal>
      )}
    </div>
  );
}
