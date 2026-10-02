import { LIABILITY_OPTIONS, VOUCH_STRENGTHS } from '@commonhours/shared';
import { useVouchTerms } from './api';

/** Strength/liability pickers that always show the liability amount and maximum penalty before consent. */
export function TermsChooser({ strength, liability, onChange, ack, onAck, voucherLabel = 'you' }: { strength: number; liability: number; onChange: (s: number, l: number) => void; ack: boolean; onAck: (v: boolean) => void; voucherLabel?: string }) {
  const terms = useVouchTerms(strength, liability);
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="label">Strength (how well you know them)</legend>
        <div className="flex gap-2">
          {VOUCH_STRENGTHS.map((s) => (
            <label key={s} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${s === strength ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-slate-300'}`}>
              <input type="radio" className="sr-only" name="strength" checked={s === strength} onChange={() => onChange(s, liability)} />
              {s}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Liability you accept</legend>
        <div className="flex gap-2">
          {LIABILITY_OPTIONS.map((l) => (
            <label key={l} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${l === liability ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-slate-300'}`}>
              <input type="radio" className="sr-only" name="liability" checked={l === liability} onChange={() => onChange(strength, l)} />
              {l}%
            </label>
          ))}
        </div>
      </fieldset>
      {terms.data && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-950">
            Maximum possible penalty for {voucherLabel}: {terms.data.maxPenaltyPoints} credibility points
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-950">
            {terms.data.terms.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => onAck(e.target.checked)} />I understand and consent to this liability.
      </label>
    </div>
  );
}
