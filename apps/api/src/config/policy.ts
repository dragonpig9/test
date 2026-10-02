/**
 * Single source of adjustable policy values. Every business rule reads from here,
 * and every audit event records POLICY.version so decisions can be traced to the
 * policy that produced them. Change values here, not in module code.
 *
 * Units: credits are hundredths (100 = 1 credit = 1 hour of standard service).
 */
export const POLICY = {
  version: 'policy-2026.10-v1',

  credits: {
    /** Members may not commit to obligations that would push available balance below this. */
    floor: -500,
    /** Default price: 1 hour = 1 credit. All hours are valued equally. */
    unitsPerHour: 100,
    /** Positive earned credits expire this many months after they were earned. Debts never expire. */
    lotExpiryMonths: 12,
    /** Upper bound on a voluntary gift bonus for a single exchange. */
    maxGiftBonus: 300,
  },

  vouches: {
    allowedStrengths: [0.4, 0.7, 1.0],
    liabilityOptions: [10, 25, 50],
    /**
     * Liability = bounded credibility penalty applied to the direct voucher after a
     * FINAL finding of nonperformance against the vouchee. penalty = pct% × maxLiabilityPoints.
     * It never moves credits.
     */
    maxLiabilityPoints: 20,
    /** Pending + active outgoing vouches + open invitations may not exceed this. */
    maxActiveOutgoing: 5,
    /** After this many months without a qualifying interaction, effective strength decays. */
    decayAfterMonths: 12,
    decayFactor: 0.5,
    /** After this many months without a qualifying interaction, the edge expires. */
    expireAfterMonths: 18,
    invitationValidDays: 14,
    /** Strengthening needs at least this many settled exchanges between the pair since activation, and goes up one level at a time. */
    strengthenRequiresSettledExchanges: 1,
    termsVersion: 'vouch-terms-v1',
  },

  bootstrap: {
    /**
     * While the community has fewer than this many members, the invite/vouch credibility
     * threshold is waived (the community could not otherwise grow from one bootstrap member).
     * The vouch limit still applies.
     */
    waiveThresholdsBelowMembers: 6,
    /** The bootstrap member is treated as holding one incoming vouch of this strength for scoring. */
    bootstrapVouchAllowance: 1.0,
  },

  credibility: {
    // Weights. Total is clamped to 0..100.
    pointsPerCompletedService: 4,
    completedServicesCap: 10,
    confirmationRateMaxPoints: 15,
    pointsPerUnitVouchStrength: 20,
    vouchStrengthCap: 1.5,
    pointsPerAttestationVote: 3,
    attestationMaxPoints: 15,
    missedVotePoints: -2,
    thresholds: {
      invite: 40,
      vouch: 40,
      attest: 30,
      /** Below this score a member needs a guarantor (an active incoming vouch ≥ guarantorMinStrength) to provide services worth more than guarantorFreeLimit. */
      guarantorBelow: 20,
      restrictedCategory: 25,
    },
    guarantorFreeLimit: 200,
    guarantorMinStrength: 0.7,
    restrictedCategories: ['Equipment repair'],
  },

  penalties: {
    /** Final finding that the provider did not perform the agreed activity. */
    nonperformanceFinding: 15,
  },

  exchanges: {
    defaultConfirmationDays: 3,
    defaultCancellationNoticeHours: 24,
  },

  attestation: {
    /** Attestors must be at least this many active hops from BOTH parties (unreachable counts as far). */
    minHops: 2,
    singleAttestors: 1,
    panelSize: 3,
    panelMajority: 2,
    voteWindowDays: 3,
    /** Demo mode uses this fixed seed so selections are reproducible. */
    demoSeed: 'commonhours-demo-2026',
  },
} as const;

export type Policy = typeof POLICY;

/** Rule identifiers recorded on audit events and ledger transactions. */
export const RULES = {
  INVITE_CREATE: 'VOUCH.INVITE.v1',
  JOIN: 'VOUCH.JOIN_CONSENT.v1',
  VOUCH_PROPOSE: 'VOUCH.PROPOSE.v1',
  VOUCH_ACCEPT: 'VOUCH.CONSENT.v1',
  VOUCH_REVOKE: 'VOUCH.REVOKE.v1',
  VOUCH_AMEND: 'VOUCH.AMEND_CONSENT.v1',
  VOUCH_INTERACTION: 'VOUCH.QUALIFYING_INTERACTION.v1',
  VOUCH_EXPIRE: 'VOUCH.EXPIRY.v1',
  TRUST_PATH: 'TRUST.BFS_PATH.v1',
  LISTING: 'SERVICES.LISTING.v1',
  EXCHANGE_TERMS: 'EXCHANGE.TERMS.v1',
  EXCHANGE_ACCEPT: 'EXCHANGE.ACCEPT.v1',
  EXCHANGE_CONFIRM: 'EXCHANGE.CONFIRM.v1',
  EXCHANGE_CANCEL: 'EXCHANGE.CANCEL.v1',
  EXCHANGE_PARTIAL: 'EXCHANGE.PARTIAL.v1',
  LEDGER_RESERVE: 'LEDGER.RESERVE_FLOOR.v1',
  LEDGER_SETTLE: 'LEDGER.SETTLE.v1',
  LEDGER_RELEASE: 'LEDGER.RELEASE.v1',
  LEDGER_FREEZE: 'LEDGER.FREEZE.v1',
  EXPIRY: 'LEDGER.CREDIT_EXPIRY.v1',
  CREDIBILITY: 'CREDIBILITY.FORMULA.v1',
  PENALTY_NONPERFORMANCE: 'CREDIBILITY.NONPERFORMANCE.v1',
  PENALTY_LIABILITY: 'CREDIBILITY.VOUCH_LIABILITY.v1',
  DISPUTE_OPEN: 'ATTEST.OPEN.v1',
  DISPUTE_SELECT: 'ATTEST.SELECTION.v1',
  DISPUTE_VOTE: 'ATTEST.VOTE.v1',
  DISPUTE_RESOLVE: 'ATTEST.RESOLVE.v1',
  DISPUTE_REVIEW: 'ATTEST.NEEDS_REVIEW.v1',
  DISPUTE_MUTUAL: 'ATTEST.MUTUAL.v1',
  CONFLICT: 'ATTEST.CONFLICT.v1',
  WITHDRAW_LEAVE: 'WITHDRAWAL.LEAVE.v1',
  DEMO: 'DEMO.v1',
} as const;
