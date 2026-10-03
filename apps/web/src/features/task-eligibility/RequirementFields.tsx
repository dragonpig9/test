import { useQuery } from '@tanstack/react-query';
import type { PermissionCheck, TrustTier } from '@commonhours/shared';
import { Field } from '../../components/ui';
import { api } from '../../lib/api';
import { TIER_LABEL } from './EligibilityPanel';

export interface Requirements {
  trustTier: TrustTier;
  minCredibility: number | null;
  minRelationshipTrust: number | null;
  maxCreditBudget: number | null;
}

interface TierInfo {
  label: string;
  examples: string;
  minCredibility: number;
  requireVerifiedContact: boolean;
  requireOwnerApproval: boolean;
}

/** Tier thresholds come from the backend policy; the form only displays them. */
export const useTiers = () =>
  useQuery({ queryKey: ['eligibility', 'tiers'], queryFn: () => api<{ tiers: Record<TrustTier, TierInfo>; score: number; permissions: PermissionCheck[] }>('/eligibility/tiers'), staleTime: 60_000 });

/**
 * Access level + requester requirements. `request`: the requester sets everything.
 * `offer`: only the access level describing the service. `readonly`: shown to the provider.
 */
export function RequirementFields({ value, onChange, mode }: { value: Requirements; onChange: (v: Requirements) => void; mode: 'request' | 'offer' | 'readonly' }) {
  const tiers = useTiers();
  const t = tiers.data?.tiers[value.trustTier];
  const set = <K extends keyof Requirements>(k: K, v: Requirements[K]) => onChange({ ...value, [k]: v });
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  if (mode === 'readonly') {
    return (
      <div className="rounded-xl border border-slate-200 p-3 text-sm">
        <p>
          <strong>Access level:</strong> {TIER_LABEL[value.trustTier]}
          {t && <span className="text-slate-600"> — {t.examples.toLowerCase()} (credibility ≥ {t.minCredibility})</span>}
        </p>
        {(value.minCredibility !== null || value.minRelationshipTrust !== null || value.maxCreditBudget !== null) && (
          <p className="mt-1 text-slate-600">
            Requester’s requirements: {[value.minCredibility !== null && `credibility ≥ ${value.minCredibility}`, value.minRelationshipTrust !== null && `relationship trust ≥ ${value.minRelationshipTrust}`, value.maxCreditBudget !== null && `budget ≤ ${value.maxCreditBudget / 100} credits`].filter(Boolean).join(' · ')}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">Only the recipient (whose home or task it is) can change these.</p>
      </div>
    );
  }
  return (
    <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold">Access level and requirements</legend>
      <Field label="Where does the work happen?" htmlFor="tier" hint={t ? `${t.label}: credibility ≥ ${t.minCredibility}${t.requireVerifiedContact ? ', verified contact' : ''}${t.requireOwnerApproval ? ' and your explicit approval for each exchange' : ''}. Meeting a score makes someone eligible; it never grants entry by itself.` : undefined}>
        <select id="tier" className="input" value={value.trustTier} onChange={(e) => set('trustTier', e.target.value as TrustTier)}>
          {(['STANDARD', 'RESTRICTED', 'HIGH_TRUST'] as const).map((k) => (
            <option key={k} value={k}>
              {TIER_LABEL[k]}
              {tiers.data ? ` — ${tiers.data.tiers[k].examples.toLowerCase()}` : ''}
            </option>
          ))}
        </select>
      </Field>
      {mode === 'request' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Minimum credibility (optional)" htmlFor="minc" hint={t ? `Can be raised above ${t.minCredibility}, never lowered.` : undefined}>
            <input id="minc" className="input" type="number" min={t?.minCredibility ?? 0} max={100} value={value.minCredibility ?? ''} onChange={(e) => set('minCredibility', num(e.target.value))} />
          </Field>
          <Field label="Minimum relationship trust (optional)" htmlFor="minr" hint="0–1: strongest chain of vouches and earned relationships between you and the provider.">
            <input id="minr" className="input" type="number" min={0} max={1} step={0.05} value={value.minRelationshipTrust ?? ''} onChange={(e) => set('minRelationshipTrust', num(e.target.value))} />
          </Field>
          <Field label="Maximum credit budget (optional)" htmlFor="budget" hint="Total incl. any gift. Quotes above it are blocked.">
            <input id="budget" className="input" type="number" min={0.25} step={0.25} value={value.maxCreditBudget === null ? '' : value.maxCreditBudget / 100} onChange={(e) => set('maxCreditBudget', e.target.value.trim() === '' ? null : Math.round(Number(e.target.value) * 100))} />
          </Field>
        </div>
      )}
    </fieldset>
  );
}
