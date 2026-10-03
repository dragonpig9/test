import type { EligibilityCheck, PermissionCheck, TaskEligibilityView, TrustTier } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import { AppError } from '../../core/errors';
import { contactRequirementMet } from '../verification/verification.guards';

/**
 * Task eligibility (pure, unit tested). Two different measures:
 *  - MEMBER CREDIBILITY (0–100): the provider's overall reliability from their history. Sets the
 *    general minimum: required = max(tier minimum, category minimum, requester's raised minimum).
 *  - RELATIONSHIP TRUST (0–1): strongest-path strength between provider and requester. Optional;
 *    only when the requester sets a minimum.
 * HIGH_TRUST tasks also need a verified contact method and the owner's explicit approval for the
 * specific exchange. Reaching a score makes someone ELIGIBLE; it never grants home access.
 */
const T = POLICY.taskEligibility.tiers;

export function tierMinimum(tier: TrustTier): number {
  return T[tier].minCredibility;
}

/** Existing restricted-category rule (e.g. Equipment repair ≥ 25), kept as a category minimum. */
export function categoryMinimum(category: string): number {
  return (POLICY.credibility.restrictedCategories as readonly string[]).includes(category) ? POLICY.credibility.thresholds.restrictedCategory : 0;
}

/** A requester may raise the minimum but never set it below the tier/category minimum. */
export function assertRequesterRequirements(tier: TrustTier, category: string, minCredibility: number | null | undefined, module: string) {
  const floor = Math.max(tierMinimum(tier), categoryMinimum(category));
  if (minCredibility !== null && minCredibility !== undefined && minCredibility < floor) {
    throw new AppError(
      'REQUIREMENT_TOO_LOW',
      `The minimum credibility for a ${T[tier].label.toLowerCase()} ${category} task is ${floor}. You can raise it, but not lower it (you asked for ${minCredibility}).`,
      module,
      { floor, requested: minCredibility, tier, category },
    );
  }
}

export type { ContactLevel as ContactVerification } from '../verification/verification.guards';
import type { ContactLevel as ContactVerification } from '../verification/verification.guards';

export interface EligibilityInputs {
  tier: TrustTier;
  category: string;
  requesterName: string;
  requesterMinCredibility: number | null;
  requesterMinRelationshipTrust: number | null;
  provider: { name: string; active: boolean; score: number; contact: ContactVerification };
  relationshipTrust: number;
  /** null = not evaluated (e.g. browsing a listing); otherwise whether the owner approved this exchange. */
  ownerApproval: { approved: boolean } | null;
  demoMode: boolean;
}

export function evaluateTaskEligibility(i: EligibilityInputs): TaskEligibilityView {
  const tier = T[i.tier];
  const tierMin = tier.minCredibility;
  const catMin = categoryMinimum(i.category);
  const required = Math.max(tierMin, catMin, i.requesterMinCredibility ?? 0);
  const reqRel = i.requesterMinRelationshipTrust && i.requesterMinRelationshipTrust > 0 ? i.requesterMinRelationshipTrust : null;
  const checks: EligibilityCheck[] = [];
  const how: string[] = [];
  const conditions: string[] = [];

  checks.push({
    key: 'memberActive',
    label: 'Active member',
    passed: i.provider.active,
    required: 'active',
    current: i.provider.active ? 'active' : 'left the community',
    explanation: i.provider.active ? 'Active members can take on new tasks.' : 'Members who have left cannot take on new tasks.',
  });

  const scoreOk = i.provider.score >= required;
  const sources = [`${tier.label} tier ${tierMin}`, ...(catMin ? [`${i.category} category ${catMin}`] : []), ...(i.requesterMinCredibility ? [`${i.requesterName}'s minimum ${i.requesterMinCredibility}`] : [])];
  checks.push({
    key: 'credibility',
    label: 'Member credibility',
    passed: scoreOk,
    required: `≥ ${required}`,
    current: String(i.provider.score),
    explanation: `Required = max(${sources.join(', ')}) = ${required}. Current credibility ${i.provider.score}.`,
  });
  if (!scoreOk) {
    const gap = Math.round((required - i.provider.score) * 10) / 10;
    how.push(
      `Raise your credibility by ${gap} point(s) to ${required}: each service you provide that both sides confirm adds ${POLICY.credibility.pointsPerCompletedService} (up to ${POLICY.credibility.completedServicesCap}), confirming on time keeps the confirmation-rate factor high, and voting when selected as an attestor adds ${POLICY.credibility.pointsPerAttestationVote}.`,
    );
  }

  if (reqRel !== null) {
    const ok = i.relationshipTrust >= reqRel - 1e-9;
    checks.push({
      key: 'relationshipTrust',
      label: `Relationship trust with ${i.requesterName}`,
      passed: ok,
      required: `≥ ${reqRel}`,
      current: String(i.relationshipTrust),
      explanation: `${i.requesterName} asked for relationship trust ≥ ${reqRel} (strongest chain of vouches and earned relationships between you). Current ${i.relationshipTrust}.`,
    });
    if (!ok) {
      how.push(`Build relationship trust with ${i.requesterName} to ${reqRel}: complete exchanges you both confirm (an earned relationship starts at ${POLICY.earnedTrust.initialStrength} and grows by ${POLICY.earnedTrust.gainRate} × (1 − strength)), or connect through members who vouch for you.`);
    }
  }

  if (tier.requireVerifiedContact) {
    // Verification prerequisite: decided by the shared guard (demo mode bypasses it; nothing else here changes).
    const { met: ok, bypassed } = contactRequirementMet(i.provider.contact, i.demoMode);
    checks.push({
      key: 'verifiedContact',
      label: 'Verified contact information',
      passed: ok,
      required: 'verified email or phone',
      current: i.provider.contact === 'VERIFIED' ? 'verified' : i.provider.contact === 'DEMO_VERIFIED' ? 'demo-verified (code shown on screen, not delivered)' : 'not verified',
      explanation: bypassed
        ? 'Demo mode: the verified-contact prerequisite is skipped. Credibility and the owner’s approval still apply.'
        : ok
        ? 'A contact method was verified with a one-time code.'
        : i.provider.contact === 'DEMO_VERIFIED'
          ? 'Demo verification does not count outside demo mode; verify with a delivered code.'
          : 'High-trust tasks need a verified contact method so the owner can reach the person in their home.',
    });
    if (!ok) how.push('Verify your contact email: Profile → Contact verification → send a code and enter it.');
  }

  if (tier.requireOwnerApproval) {
    conditions.push(`${i.requesterName} must explicitly approve home access for this specific exchange. Meeting the score makes you eligible; it does not grant entry.`);
    if (i.ownerApproval) {
      checks.push({
        key: 'ownerApproval',
        label: 'Owner approval for home access',
        passed: i.ownerApproval.approved,
        pending: !i.ownerApproval.approved,
        required: 'approved by the owner for this terms version',
        current: i.ownerApproval.approved ? 'approved' : 'not yet approved',
        explanation: i.ownerApproval.approved
          ? `${i.requesterName} approved home access for this exchange.`
          : `Waiting for ${i.requesterName} to approve home access. Changing the terms clears an earlier approval.`,
      });
    }
  }
  if (i.tier !== 'STANDARD') conditions.push(`${tier.label}: ${tier.examples.toLowerCase()}.`);

  const memberChecks = checks.filter((c) => c.key !== 'ownerApproval');
  const locked = memberChecks.some((c) => !c.passed);
  const eligible = checks.every((c) => c.passed);
  const summary = locked
    ? `Locked: needs ${memberChecks.filter((c) => !c.passed).map((c) => c.label.toLowerCase()).join(', ')}.`
    : eligible
      ? `Eligible for this ${tier.label.toLowerCase()} task.`
      : `Eligible; waiting for the owner's approval.`;
  return {
    tier: i.tier,
    tierLabel: tier.label,
    tierExamples: tier.examples,
    eligible,
    locked,
    requiredCredibility: required,
    currentCredibility: i.provider.score,
    requirementSources: { tierMinimum: tierMin, categoryMinimum: catMin, requesterMinimum: i.requesterMinCredibility },
    requiredRelationshipTrust: reqRel,
    currentRelationshipTrust: reqRel !== null ? i.relationshipTrust : null,
    checks,
    conditions,
    howToBecomeEligible: how,
    summary,
  };
}

/** Score part of each tier, shown with the other permissions (verification/approval are per task). */
export function tierPermissions(score: number): PermissionCheck[] {
  const entry = (key: PermissionCheck['key'], t: TrustTier, extra: string): PermissionCheck => ({
    key,
    label: `Take ${T[t].label.toLowerCase()} tasks (${T[t].examples.toLowerCase()})`,
    allowed: score >= T[t].minCredibility,
    threshold: T[t].minCredibility,
    current: score,
    explanation: `Requires credibility ≥ ${T[t].minCredibility}.${extra} Requesters may set a higher minimum or a relationship-trust minimum.`,
    toUnlock: score >= T[t].minCredibility ? null : `Reach ${T[t].minCredibility} points (${Math.round((T[t].minCredibility - score) * 10) / 10} more), e.g. by completing services that both sides confirm on time.`,
  });
  return [
    entry('restrictedTasks', 'RESTRICTED', ''),
    entry('highTrustTasks', 'HIGH_TRUST', ' Each task also needs a verified contact method and the owner’s explicit approval.'),
  ];
}
