import { useState } from 'react';
import { SERVICE_CATEGORIES, type ServiceCategory } from '@commonhours/shared';
import { Button, ErrorBox, Field } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { credits, fromLocalInput, toLocalInput } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { proposeExchange, updateTerms } from './api';

export interface TermsInit {
  deliverable: string;
  category: ServiceCategory;
  durationMinutes: number;
  scheduledAt?: string;
  location: string;
  punctualityRequired: boolean;
  giftBonus: number;
  cancellationNoticeHours: number;
  cancellationTerms: string;
  confirmationDays: number;
}

/**
 * The agreement form. Both parties see and accept the same terms version before any work starts.
 * The preview of credits is informational; the server computes the authoritative amount
 * (1 hour = 1 credit) and rejects anything that breaks a rule.
 */
export function TermsForm({
  mode,
  init,
  myRole,
  counterpartyId,
  counterpartyName,
  listingId,
  linkedExchangeId,
  exchangeId,
  onDone,
}: {
  mode: 'propose' | 'edit';
  init: TermsInit;
  myRole: 'provider' | 'recipient';
  counterpartyId?: string;
  counterpartyName: string;
  listingId?: string;
  linkedExchangeId?: string;
  exchangeId?: string;
  onDone: (exchangeId: string) => void;
}) {
  const { me } = useAuth();
  // Default: two hours after the current (simulated) time, on the hour.
  const soon = new Date(new Date(me!.now).getTime() + 2 * 3_600_000);
  soon.setUTCMinutes(0, 0, 0);
  const [t, setT] = useState({ ...init, scheduledAt: init.scheduledAt ?? soon.toISOString() });
  const set = <K extends keyof typeof t>(k: K, v: (typeof t)[K]) => setT((x) => ({ ...x, [k]: v }));
  const body = {
    deliverable: t.deliverable,
    durationMinutes: t.durationMinutes,
    scheduledAt: t.scheduledAt,
    location: t.location,
    punctualityRequired: t.punctualityRequired,
    giftBonus: myRole === 'recipient' ? t.giftBonus : init.giftBonus,
    cancellationNoticeHours: t.cancellationNoticeHours,
    cancellationTerms: t.cancellationTerms,
    confirmationDays: t.confirmationDays,
  };
  const submit = useAction(
    () =>
      mode === 'propose'
        ? proposeExchange({ ...body, category: t.category, counterpartyId: counterpartyId!, myRole, listingId, linkedExchangeId })
        : updateTerms(exchangeId!, body),
    (r) => onDone(r.exchange.id),
  );
  const standard = Math.round((t.durationMinutes / 60) * 100);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate(undefined);
      }}
    >
      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        <strong>{myRole === 'provider' ? 'You provide' : 'You receive'}</strong> · {myRole === 'provider' ? `${counterpartyName} receives and pays` : `${counterpartyName} provides and is paid`}.
        {linkedExchangeId && <span className="block text-xs">This is a separate exchange linked to the earlier one. It has its own terms, reservation and confirmations.</span>}
      </div>
      <Field label="Deliverable (what exactly will be done)" htmlFor="deliv">
        <textarea id="deliv" className="input" rows={2} value={t.deliverable} onChange={(e) => set('deliverable', e.target.value)} required minLength={3} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === 'propose' && (
          <Field label="Category" htmlFor="cat">
            <select id="cat" className="input" value={t.category} onChange={(e) => set('category', e.target.value as ServiceCategory)}>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Duration" htmlFor="dur">
          <select id="dur" className="input" value={t.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))}>
            {[30, 60, 90, 120, 180, 240, 300].map((m) => (
              <option key={m} value={m}>
                {m / 60} hour(s)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scheduled time (UTC)" htmlFor="when">
          <input id="when" className="input" type="datetime-local" value={toLocalInput(t.scheduledAt)} onChange={(e) => e.target.value && set('scheduledAt', fromLocalInput(e.target.value))} required />
        </Field>
        <Field label="Location (or “online”)" htmlFor="loc">
          <input id="loc" className="input" value={t.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field label="Cancellation notice (hours)" htmlFor="cn" hint="Free cancellation until this many hours before; later needs both to agree.">
          <input id="cn" className="input" type="number" min={0} max={336} value={t.cancellationNoticeHours} onChange={(e) => set('cancellationNoticeHours', Number(e.target.value))} />
        </Field>
        <Field label="Completion confirmation deadline (days after the service)" htmlFor="cd">
          <input id="cd" className="input" type="number" min={1} max={14} value={t.confirmationDays} onChange={(e) => set('confirmationDays', Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Cancellation terms (free text)" htmlFor="ct">
        <input id="ct" className="input" value={t.cancellationTerms} onChange={(e) => set('cancellationTerms', e.target.value)} />
      </Field>
      <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm">
        <input type="checkbox" className="mt-1" checked={t.punctualityRequired} onChange={(e) => set('punctualityRequired', e.target.checked)} />
        <span>
          <strong>Punctuality is a required condition.</strong> Only if ticked can lateness be raised in a dispute.
        </span>
      </label>
      {myRole === 'recipient' ? (
        <Field label="Optional gift bonus (credits, from you)" htmlFor="gift" hint="Voluntary, shown separately from the standard hourly amount, agreed before work starts. Cannot change after acceptance.">
          <input id="gift" className="input" type="number" min={0} max={3} step={0.25} value={t.giftBonus / 100} onChange={(e) => set('giftBonus', Math.round(Number(e.target.value) * 100))} />
        </Field>
      ) : (
        init.giftBonus > 0 && <p className="text-sm text-slate-600">Gift bonus offered by the recipient: {credits(init.giftBonus)} (only they can change it).</p>
      )}
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-950">
        Preview: {t.durationMinutes / 60}h × 1 credit/hour = <strong>{credits(standard)}</strong> standard credit(s)
        {(myRole === 'recipient' ? t.giftBonus : init.giftBonus) > 0 && <> + <strong>{credits(myRole === 'recipient' ? t.giftBonus : init.giftBonus)}</strong> gift bonus</>}. The server computes the final amount; it is reserved from the recipient when both accept.
      </div>
      <ErrorBox error={submit.error} />
      <Button type="submit" busy={submit.isPending}>
        {mode === 'propose' ? 'Propose these terms' : 'Save as new terms version'}
      </Button>
      {mode === 'edit' && <p className="text-xs text-slate-500">Saving creates a new terms version. You accept it; the other member must accept again.</p>}
    </form>
  );
}
