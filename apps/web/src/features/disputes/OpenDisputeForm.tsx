import { useState } from 'react';
import type { ExchangeView } from '@commonhours/shared';
import { Button, ErrorBox, Field } from '../../components/ui';
import { useAction } from '../../lib/mutations';
import { openDispute } from './api';

const CONDITIONS = [
  { value: 'DELIVERABLE', label: 'The agreed deliverable was not provided' },
  { value: 'DURATION', label: 'The agreed duration was not provided' },
  { value: 'PUNCTUALITY', label: 'The provider was late (only if punctuality was agreed)' },
  { value: 'NO_SHOW', label: 'The service did not happen at all' },
] as const;

export function OpenDisputeForm({ exchange, onDone }: { exchange: ExchangeView; onDone: (disputeId: string) => void }) {
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]['value']>(exchange.punctualityRequired ? 'PUNCTUALITY' : 'DELIVERABLE');
  const [claim, setClaim] = useState('');
  const submit = useAction(() => openDispute({ exchangeId: exchange.id, condition, claim }), (r) => onDone(r.dispute.id));
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit.mutate(undefined); }}>
      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        Attestation checks only whether the <strong>pre-agreed activity</strong> happened as agreed. Opening a dispute freezes the reserved credits; it does not change anyone’s credibility. Only a final finding can.
      </div>
      <fieldset>
        <legend className="label">Which agreed condition was not met?</legend>
        <div className="space-y-2">
          {CONDITIONS.map((c) => {
            const blocked = c.value === 'PUNCTUALITY' && !exchange.punctualityRequired;
            return (
              <label key={c.value} className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${condition === c.value ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
                <input type="radio" className="mt-1" checked={condition === c.value} onChange={() => setCondition(c.value)} />
                <span>
                  {c.label}
                  {blocked && <span className="block text-xs text-amber-800">Punctuality was not agreed for this exchange, so the server will reject this.</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <Field label="Your statement" htmlFor="claim" hint="Refer to the agreed terms. At least 10 characters.">
        <textarea id="claim" className="input" rows={3} value={claim} onChange={(e) => setClaim(e.target.value)} required minLength={10} />
      </Field>
      <ErrorBox error={submit.error} title="Dispute not opened" />
      <Button type="submit" variant="danger" busy={submit.isPending}>
        Open dispute and freeze credits
      </Button>
    </form>
  );
}
