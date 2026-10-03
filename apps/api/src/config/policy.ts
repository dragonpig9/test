/**
 * Single source of adjustable policy values. Every business rule reads from here,
 * and every audit event records POLICY.version so decisions can be traced to the
 * policy that produced them. Change values here, not in module code.
 *
 * Units: credits are hundredths (100 = 1 credit = 1 hour of standard service).
 */
export const POLICY = {
  version: 'policy-2026.10-v3',

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

  /**
   * Task eligibility. Uses MEMBER CREDIBILITY (0–100) for the general tier minimum, plus an optional
   * RELATIONSHIP TRUST (0–1, strongest path between provider and requester) set by the requester.
   * Meeting a threshold makes someone eligible; it never grants home access by itself.
   *
   * Initial thresholds (credibility scale 0–100):
   *   STANDARD    0  — anyone (the guarantor rule still applies to larger services).
   *   RESTRICTED 25  — same value as the existing restricted-category threshold.
   *   HIGH_TRUST 35  — roughly an invited member with two or more on-time confirmed services
   *                    (e.g. 0.7 vouch 14 + confirmation rate 15 + 2 services 8 = 37).
   * Category minimums (e.g. Equipment repair ≥ 25) still apply on top: required = max(tier, category, requester).
   */
  taskEligibility: {
    tiers: {
      STANDARD: {
        label: 'Standard',
        examples: 'Online tutoring, translation, basic help in a public place',
        minCredibility: 0,
        requireVerifiedContact: false,
        requireOwnerApproval: false,
      },
      RESTRICTED: {
        label: 'Restricted',
        examples: "Visiting someone's home while they are present",
        minCredibility: 25,
        requireVerifiedContact: false,
        requireOwnerApproval: false,
      },
      HIGH_TRUST: {
        label: 'High trust',
        examples: "Entering someone's home while the owner is absent",
        minCredibility: 35,
        requireVerifiedContact: true,
        requireOwnerApproval: true,
      },
    },
  },

  /**
   * Explainable pricing (credits in hundredths, integer arithmetic only):
   *   base credits    = hours × 100
   *   service credits = round½↑(base × skill% × demand% / 10 000)
   *   total           = service credits + optional pre-agreed gift bonus
   * Multipliers are kept in hundredths (125 = ×1.25). Rounding rule: half-up to 0.01 credit, once, at the end.
   */
  pricing: {
    skillTiers: {
      STANDARD: { multiplierPct: 100, requiredApprovals: 0 },
      SKILLED: { multiplierPct: 125, requiredApprovals: 1 },
      ADVANCED: { multiplierPct: 150, requiredApprovals: 1 },
      SPECIALIST: { multiplierPct: 200, requiredApprovals: 2 },
    },
    /** Reviewers of skill claims need at least this credibility (same as the vouch threshold). */
    reviewerMinCredibility: 40,
    demand: {
      /** Requests older than this are treated as expired and excluded. */
      windowDays: 45,
      /** Fewer unique active requesters than this = insufficient data → ×1.00. */
      minUniqueRequests: 2,
      /** multiplier = clamp(1 + slope × (ratio − 1), min, max) with ratio = unique requests / providers. */
      slopePct: 10,
      minPct: 100,
      maxPct: 150,
    },
  },

  /**
   * Earned relationships: created/strengthened only by exchanges both parties confirmed in full
   * (mutual confirmation). Disputed, partial, cancelled, refuted or unresolved exchanges never count.
   *   first eligible exchange → strength = initialStrength
   *   later ones              → strength = min(maxStrength, old + gainRate × (1 − old))
   * Limits against manufactured trust: hard cap below a full vouch (1.0), at most
   * maxCountedPerWindow increases per pair per windowDays, and diminishing gains from the formula.
   * Earned edges decay/expire like vouches (POLICY.vouches decay/expiry, from the last exchange).
   */
  earnedTrust: {
    initialStrength: 0.2,
    gainRate: 0.1,
    maxStrength: 0.7,
    maxCountedPerWindow: 2,
    windowDays: 30,
  },

  attestation: {
    /** Attestors must be at least this many active hops from BOTH parties (unreachable counts as far). */
    minHops: 2,
    /** "Available to participate": members with this many open (unvoted) assignments are skipped. */
    maxOpenAssignments: 2,
    /** Closeness values are compared after rounding to this many decimals; equal values are randomised. */
    closenessDecimals: 2,
    singleAttestors: 1,
    panelSize: 3,
    panelMajority: 2,
    voteWindowDays: 3,
    /** Demo mode uses this fixed seed so selections are reproducible. */
    demoSeed: 'commonhours-demo-2026',
  },

  /** Calendar used for "days": activity points, the scoring window and the daily job (00:00 local). */
  schedule: {
    timezone: 'Asia/Hong_Kong',
    /** Local hour at which the daily job runs (0 = 00:00). */
    dailyJobHour: 0,
    /** A RUNNING daily-job record older than this (wall clock) is treated as crashed and re-claimed. */
    staleRunMinutes: 15,
  },

  /** Student registration (university list + email domains: packages/shared/src/universities.ts). */
  student: {
    codeMinutes: 30,
    maxAttempts: 5,
  },

  /**
   * Activity points (one shared scoring function for the friends leaderboard AND the pool):
   *   1 point per distinct counterparty per local calendar day, from SETTLED exchanges in the window.
   * Logins, page views, listings, cancelled/declined/released exchanges, unresolved disputes and pool
   * rewards never score. Activity points are separate from credits, credibility and relationship strength.
   */
  activity: {
    windowDays: 7,
    pointsPerCounterpartyPerDay: 1,
    /**
     * Existing anti-abuse rule reused from earned trust (earnedTrust.maxCountedPerWindow): a pair of
     * members can earn each other at most this many points per scoring window. null = no cap.
     */
    maxPointsPerPairPerWindow: 2 as number | null,
  },

  /** Community Credit Pool: receives expired credits; the daily job redistributes it. The pool never expires. */
  communityPool: {
    /** recipients = ceil(activeUsers × numerator / denominator) */
    recipientShareNumerator: 1,
    recipientShareDenominator: 2,
    /** Smallest payment in ledger units (hundredths): 1 = 0.01 credit. Smaller → the pool is retained. */
    minPaymentUnits: 1,
  },

  /** Close-friend reminders after a long continuous negative POSTED balance. */
  negativeBalance: {
    /** Strictly more than this many days negative triggers the reminder (exactly 50 does not). */
    reminderAfterDays: 50,
    maxFriendsNotified: 3,
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
  TRUST_PATH: 'TRUST.STRONGEST_PATH.v2',
  TRUST_EARNED: 'TRUST.EARNED_EDGE.v1',
  TASK_ELIGIBILITY: 'TASK.ELIGIBILITY.v1',
  HOME_ACCESS: 'TASK.HOME_ACCESS_APPROVAL.v1',
  PRICING_QUOTE: 'PRICING.QUOTE.v1',
  PRICING_LOCK: 'PRICING.LOCK.v1',
  SKILL_CLAIM: 'PRICING.SKILL_CLAIM.v1',
  SKILL_REVIEW: 'PRICING.SKILL_REVIEW.v1',
  PROFILE_UPDATE: 'PROFILE.UPDATE.v1',
  CONTACT_VERIFY: 'PROFILE.CONTACT_VERIFICATION.v1',
  NOTIFY: 'NOTIFY.v1',
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
  DISPUTE_SELECT: 'ATTEST.SELECTION.v2',
  DISPUTE_VOTE: 'ATTEST.VOTE.v1',
  DISPUTE_RESOLVE: 'ATTEST.RESOLVE.v1',
  DISPUTE_REVIEW: 'ATTEST.NEEDS_REVIEW.v1',
  DISPUTE_MUTUAL: 'ATTEST.MUTUAL.v1',
  CONFLICT: 'ATTEST.CONFLICT.v1',
  WITHDRAW_LEAVE: 'WITHDRAWAL.LEAVE.v1',
  DEMO: 'DEMO.v1',
  DEMO_ADMISSION: 'DEMO.VERIFICATION_BYPASS.v1',
  STUDENT_DETAILS: 'STUDENT.DETAILS.v1',
  STUDENT_JOIN: 'ONBOARDING.STUDENT_ROUTE.v1',
  STUDENT_VERIFY: 'STUDENT.EMAIL_VERIFICATION.v1',
  ACTIVITY_SCORE: 'ACTIVITY.DISTINCT_COUNTERPARTY_DAY.v1',
  EXPIRY_TO_POOL: 'LEDGER.CREDIT_EXPIRY_TO_POOL.v2',
  POOL_DISTRIBUTE: 'POOL.DAILY_REDISTRIBUTION.v1',
  NEGATIVE_BALANCE: 'CREDITS.NEGATIVE_BALANCE_PERIOD.v1',
  NEGATIVE_REMINDER: 'CREDITS.NEGATIVE_BALANCE_REMINDER.v1',
  DAILY_JOB: 'JOBS.DAILY.v1',
} as const;
