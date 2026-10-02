import type { CredibilityFactor, PermissionCheck } from '@commonhours/shared';
import { POLICY } from '../../config/policy';

/**
 * Deterministic, rule-based credibility score (0–100). No black-box scoring.
 *
 *   completed services   = 4 × min(settled services provided, 10)                  (max 40)
 *   confirmation rate    = 15 × timely confirmations / finalized non-disputed exchanges (max 15)
 *   incoming vouches     = 20 × min(Σ effective strength of active incoming vouches, 1.5) (max 30)
 *   dispute outcomes     = − Σ penalty points from FINAL findings (nonperformance, vouch liability, misconduct)
 *   attestation          = max(0, 3 × votes cast − 2 × votes missed), capped at 15     (max 15)
 *
 * Members with no history: history-based factors are 0 ("unknown" is not treated as good or bad);
 * the incoming-vouch factor gives newcomers their starting score.
 * Opening a dispute changes nothing; only finalized findings create penalties.
 * Credibility cannot be bought, sold or transferred: no ledger operation reads or writes it.
 */
export interface CredibilityInputs {
  completedServices: number;
  finalizedNonDisputed: number;
  timelyConfirmations: number;
  incomingStrengthSum: number;
  incomingVouchCount: number;
  bootstrapAllowance: number;
  penaltyPoints: number;
  votesCast: number;
  votesMissed: number;
}

export interface CredibilityResult {
  score: number;
  factors: CredibilityFactor[];
}

const C = POLICY.credibility;

export function computeScore(i: CredibilityInputs): CredibilityResult {
  const completed = Math.min(i.completedServices, C.completedServicesCap);
  const completedPts = completed * C.pointsPerCompletedService;

  const rate = i.finalizedNonDisputed > 0 ? i.timelyConfirmations / i.finalizedNonDisputed : null;
  const ratePts = rate === null ? 0 : round1(rate * C.confirmationRateMaxPoints);

  const strength = Math.min(i.incomingStrengthSum + i.bootstrapAllowance, C.vouchStrengthCap);
  const vouchPts = round1(strength * C.pointsPerUnitVouchStrength);

  const penaltyPts = -i.penaltyPoints;

  const attestRaw = i.votesCast * C.pointsPerAttestationVote + i.votesMissed * C.missedVotePoints;
  const attestPts = Math.min(Math.max(0, attestRaw), C.attestationMaxPoints);

  const factors: CredibilityFactor[] = [
    {
      key: 'completedServices',
      label: 'Completed services',
      points: completedPts,
      maxPoints: C.completedServicesCap * C.pointsPerCompletedService,
      inputs: { settledServicesProvided: i.completedServices },
      calculation: `${C.pointsPerCompletedService} × min(${i.completedServices}, ${C.completedServicesCap}) = ${completedPts}`,
    },
    {
      key: 'confirmationRate',
      label: 'Mutual confirmation rate',
      points: ratePts,
      maxPoints: C.confirmationRateMaxPoints,
      inputs: { timelyConfirmations: i.timelyConfirmations, finalizedNonDisputedExchanges: i.finalizedNonDisputed },
      calculation:
        rate === null
          ? 'No finalized exchanges yet → 0 (no history is treated as unknown, not bad)'
          : `${C.confirmationRateMaxPoints} × ${i.timelyConfirmations}/${i.finalizedNonDisputed} = ${ratePts}`,
    },
    {
      key: 'incomingVouches',
      label: 'Quality of active incoming vouches',
      points: vouchPts,
      maxPoints: round1(C.vouchStrengthCap * C.pointsPerUnitVouchStrength),
      inputs: {
        activeIncomingVouches: i.incomingVouchCount,
        sumEffectiveStrength: round2(i.incomingStrengthSum),
        bootstrapAllowance: i.bootstrapAllowance,
      },
      calculation: `${C.pointsPerUnitVouchStrength} × min(${round2(i.incomingStrengthSum)}${i.bootstrapAllowance ? ` + ${i.bootstrapAllowance} bootstrap` : ''}, ${C.vouchStrengthCap}) = ${vouchPts}`,
    },
    {
      key: 'disputeOutcomes',
      label: 'Finalized dispute outcomes',
      points: penaltyPts,
      maxPoints: 0,
      inputs: { penaltyPointsFromFinalFindings: i.penaltyPoints },
      calculation: i.penaltyPoints ? `−${i.penaltyPoints} from final findings` : '0 — no final findings against this member (open disputes never count)',
    },
    {
      key: 'attestation',
      label: 'Attestation participation',
      points: attestPts,
      maxPoints: C.attestationMaxPoints,
      inputs: { votesCast: i.votesCast, votesMissed: i.votesMissed },
      calculation: `min(max(0, ${C.pointsPerAttestationVote} × ${i.votesCast} ${C.missedVotePoints < 0 ? '−' : '+'} ${Math.abs(C.missedVotePoints)} × ${i.votesMissed}), ${C.attestationMaxPoints}) = ${attestPts}`,
    },
  ];
  const raw = factors.reduce((s, f) => s + f.points, 0);
  return { score: round1(Math.min(100, Math.max(0, raw))), factors };
}

export const FORMULA_TEXT =
  'score = clamp(0, 100, completed services + confirmation rate + incoming vouches − final-finding penalties + attestation participation)';

export const DISCLAIMER =
  'Credibility summarises recorded community activity. It does not prove professional qualifications, licences or safety, and it cannot be bought, sold or transferred.';

export function permissionsFor(score: number, opts: { bootstrapWaiver: boolean; vouchSlotsLeft: number }): PermissionCheck[] {
  const t = C.thresholds;
  const need = (th: number) => (score >= th ? null : `Reach ${th} points (${round1(th - score)} more), e.g. by completing services that both sides confirm on time.`);
  const inviteAllowed = (score >= t.invite || opts.bootstrapWaiver) && opts.vouchSlotsLeft > 0;
  const vouchAllowed = (score >= t.vouch || opts.bootstrapWaiver) && opts.vouchSlotsLeft > 0;
  const slotNote = opts.vouchSlotsLeft > 0 ? `${opts.vouchSlotsLeft} vouch slot(s) left.` : `Vouch limit reached (${POLICY.vouches.maxActiveOutgoing}); revoke or let a vouch lapse first.`;
  return [
    {
      key: 'invite',
      label: 'Invite new members',
      allowed: inviteAllowed,
      threshold: t.invite,
      current: score,
      explanation: opts.bootstrapWaiver
        ? `Bootstrap phase: threshold waived while the community has fewer than ${POLICY.bootstrap.waiveThresholdsBelowMembers} members. ${slotNote}`
        : `Requires credibility ≥ ${t.invite}. ${slotNote}`,
      toUnlock: inviteAllowed ? null : opts.vouchSlotsLeft <= 0 ? slotNote : need(t.invite),
    },
    {
      key: 'vouch',
      label: 'Vouch for existing members',
      allowed: vouchAllowed,
      threshold: t.vouch,
      current: score,
      explanation: `Requires credibility ≥ ${t.vouch}. ${slotNote}`,
      toUnlock: vouchAllowed ? null : opts.vouchSlotsLeft <= 0 ? slotNote : need(t.vouch),
    },
    {
      key: 'attest',
      label: 'Serve as an attestor',
      allowed: score >= t.attest,
      threshold: t.attest,
      current: score,
      explanation: `Requires credibility ≥ ${t.attest}. Eligibility also depends on graph distance and conflicts for each dispute.`,
      toUnlock: need(t.attest),
    },
    {
      key: 'noGuarantorNeeded',
      label: 'Provide larger services without a guarantor',
      allowed: score >= t.guarantorBelow,
      threshold: t.guarantorBelow,
      current: score,
      explanation: `Below ${t.guarantorBelow}, providing a service worth more than ${C.guarantorFreeLimit / 100} credits needs a guarantor: an active incoming vouch of strength ≥ ${C.guarantorMinStrength}.`,
      toUnlock: need(t.guarantorBelow),
    },
    {
      key: 'restrictedCategories',
      label: `Offer restricted categories (${C.restrictedCategories.join(', ')})`,
      allowed: score >= t.restrictedCategory,
      threshold: t.restrictedCategory,
      current: score,
      explanation: `Requires credibility ≥ ${t.restrictedCategory}. This is a community safeguard, not proof of professional qualification.`,
      toUnlock: need(t.restrictedCategory),
    },
  ];
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
