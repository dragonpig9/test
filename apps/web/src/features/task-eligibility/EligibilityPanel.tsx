import type { TaskEligibilityView, TrustTier } from '@commonhours/shared';
import clsx from 'clsx';

export const TIER_LABEL: Record<TrustTier, string> = { STANDARD: 'Standard', RESTRICTED: 'Restricted', HIGH_TRUST: 'High trust' };
export const TIER_HELP: Record<TrustTier, string> = {
  STANDARD: 'Online, in a public place, or basic help.',
  RESTRICTED: 'In someone’s home while they are present.',
  HIGH_TRUST: 'Entering someone’s home while the owner is absent. Also needs verified contact and the owner’s explicit approval.',
};

export function TierBadge({ tier }: { tier: TrustTier }) {
  if (tier === 'STANDARD') return null;
  return (
    <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tier === 'HIGH_TRUST' ? 'bg-violet-50 text-violet-800 ring-violet-200' : 'bg-sky-50 text-sky-800 ring-sky-200')} title={TIER_HELP[tier]}>
      {TIER_LABEL[tier]}
    </span>
  );
}

/** Short lock line for listing cards. */
export function LockLine({ e }: { e: TaskEligibilityView }) {
  if (!e.locked) return <span className="text-xs font-medium text-brand-700">✓ You can take this {e.tierLabel.toLowerCase()} task{e.conditions.length && e.tier === 'HIGH_TRUST' ? ' (owner approval still needed)' : ''}</span>;
  return (
    <span className="text-xs font-medium text-slate-700">
      <span aria-hidden>🔒 </span>
      <span className="sr-only">Locked: </span>
      Needs credibility {e.requiredCredibility} — you have {e.currentCredibility}
      {e.checks.filter((c) => !c.passed && c.key !== 'credibility' && c.key !== 'ownerApproval').map((c) => ` · ${c.label.toLowerCase()}`).join('')}
    </span>
  );
}

/** Full explanation: required vs current score, every check, extra conditions and how to become eligible. */
export function EligibilityPanel({ e, perspective = 'provider' }: { e: TaskEligibilityView; perspective?: 'provider' | 'owner' }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <TierBadge tier={e.tier} />
        <span className={clsx('font-semibold', e.locked ? 'text-slate-800' : 'text-brand-800')}>
          {e.locked ? '🔒 ' : e.eligible ? '✓ ' : '◐ '}
          {e.summary}
        </span>
      </div>
      <p className="text-xs text-slate-600">
        {e.tierLabel}: {e.tierExamples}. Required credibility <strong>{e.requiredCredibility}</strong> = max(tier {e.requirementSources.tierMinimum}
        {e.requirementSources.categoryMinimum ? `, category ${e.requirementSources.categoryMinimum}` : ''}
        {e.requirementSources.requesterMinimum !== null ? `, requester ${e.requirementSources.requesterMinimum}` : ''}). {perspective === 'provider' ? 'Your' : 'The provider’s'} current credibility: <strong>{e.currentCredibility}</strong>.
      </p>
      <ul className="space-y-1.5">
        {e.checks.map((c) => (
          <li key={c.key} className={clsx('rounded-lg border p-2', c.passed ? 'border-brand-200 bg-brand-50/50' : c.pending ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50')}>
            <p className="font-medium">
              {c.passed ? '✓' : c.pending ? '…' : '✗'} {c.label} <span className="font-normal text-slate-600">— needs {c.required}, current {c.current}</span>
            </p>
            <p className="text-xs text-slate-600">{c.explanation}</p>
          </li>
        ))}
      </ul>
      {e.conditions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-700">Additional conditions</p>
          <ul className="list-disc pl-5 text-xs text-slate-600">
            {e.conditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {e.howToBecomeEligible.length > 0 && (
        <div className="rounded-lg bg-slate-50 p-2.5">
          <p className="text-xs font-semibold text-slate-700">How to become eligible</p>
          <ul className="list-disc pl-5 text-xs text-slate-600">
            {e.howToBecomeEligible.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
