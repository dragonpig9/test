import { useState } from 'react';
import { SERVICE_CATEGORIES, type CreateListingInput } from '@commonhours/shared';
import { Button, ErrorBox, Field } from '../../components/ui';
import { useAction } from '../../lib/mutations';
import { RequirementFields, type Requirements } from '../task-eligibility/RequirementFields';
import { createListing } from './api';

export function NewListingForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState<CreateListingInput>({ type: 'OFFER', title: '', description: '', category: 'Tutoring', durationMinutes: 60, locationType: 'ONLINE', location: '', availability: '', requiredSkills: [] });
  const [skills, setSkills] = useState('');
  const [req, setReq] = useState<Requirements>({ trustTier: 'STANDARD', minCredibility: null, minRelationshipTrust: null, maxCreditBudget: null });
  const save = useAction(
    () =>
      createListing({
        ...f,
        requiredSkills: skills.split(',').map((s) => s.trim()).filter(Boolean),
        ...(f.type === 'REQUEST' ? req : { trustTier: req.trustTier }),
      }),
    onDone,
  );
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <fieldset className="flex gap-2">
        <legend className="label">I want to…</legend>
        {(['OFFER', 'REQUEST'] as const).map((t) => (
          <label key={t} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${f.type === t ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-slate-300'}`}>
            <input type="radio" className="sr-only" checked={f.type === t} onChange={() => setF({ ...f, type: t })} />
            {t === 'OFFER' ? 'Offer help' : 'Request help'}
          </label>
        ))}
      </fieldset>
      <Field label="Title" htmlFor="lt">
        <input id="lt" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} />
      </Field>
      <Field label="Description" htmlFor="ld">
        <textarea id="ld" className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required minLength={3} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="lc" hint={f.category === 'Equipment repair' ? 'Offering this needs credibility ≥ 25 (a safeguard, not a qualification check).' : undefined}>
          <select id="lc" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as CreateListingInput['category'] })}>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Typical duration" htmlFor="ldur">
          <select id="ldur" className="input" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })}>
            {[30, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {m / 60} hour(s)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Where" htmlFor="lwhere">
          <select id="lwhere" className="input" value={f.locationType} onChange={(e) => setF({ ...f, locationType: e.target.value as 'ONLINE' | 'IN_PERSON' })}>
            <option value="ONLINE">Online</option>
            <option value="IN_PERSON">In person</option>
          </select>
        </Field>
        <Field label="Area / address hint" htmlFor="lloc">
          <input id="lloc" className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <Field label="Availability" htmlFor="lav">
          <input id="lav" className="input" value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })} required minLength={2} placeholder="e.g. weekday evenings" />
        </Field>
        <Field label="Required skills (comma separated)" htmlFor="lsk">
          <input id="lsk" className="input" value={skills} onChange={(e) => setSkills(e.target.value)} />
        </Field>
      </div>
      <RequirementFields value={req} onChange={setReq} mode={f.type === 'REQUEST' ? 'request' : 'offer'} />
      <ErrorBox error={save.error} />
      <Button type="submit" busy={save.isPending}>
        Post listing
      </Button>
    </form>
  );
}
