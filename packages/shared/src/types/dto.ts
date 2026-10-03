import type { AdmissionView } from './community';
import type {
  AssignmentStatus,
  DisputeCondition,
  DisputeOutcome,
  DisputeStatus,
  ExchangeStatus,
  InvitationStatus,
  ListingStatus,
  ListingType,
  LocationType,
  MemberStatus,
  EmailStatus,
  NotificationCategory,
  ReservationStatus,
  SkillTier,
  TrustTier,
  VoteChoice,
  VouchStatus,
} from './domain';

export interface MemberSummary {
  id: string;
  handle: string;
  displayName: string;
  status: MemberStatus;
  isBootstrap: boolean;
  /** Public profile basics (self-reported) and whether a contact method was actually verified. */
  photoUrl?: string | null;
  affiliation?: string;
  neighborhood?: string;
  contactVerification?: 'VERIFIED' | 'DEMO_VERIFIED' | 'UNVERIFIED';
  /** Student accounts: university code (public) and whether the university email was verified. */
  university?: string | null;
  universityEmailVerified?: boolean;
  /** "Demo student" / "Demo member" when admitted through the demo-mode bypass (never a verified badge). */
  demoBadge?: 'Demo student' | 'Demo member' | null;
}

export interface MemberProfile extends MemberSummary {
  bio: string;
  skills: string[];
  location: string;
  joinedAt: string;
  leftAt: string | null;
}

export interface PermissionCheck {
  key: 'invite' | 'vouch' | 'attest' | 'noGuarantorNeeded' | 'restrictedCategories' | 'restrictedTasks' | 'highTrustTasks';
  label: string;
  allowed: boolean;
  threshold: number;
  current: number;
  explanation: string;
  toUnlock: string | null;
}

export interface Me {
  member: MemberProfile;
  permissions: PermissionCheck[];
  demoMode: boolean;
  admission: AdmissionView;
  now: string;
}

export interface EdgeView {
  id: string;
  voucherId: string;
  voucheeId: string;
  strength: number;
  effectiveStrength: number;
  status: VouchStatus;
  storedStatus: VouchStatus;
  liabilityPct: number;
  maxPenaltyPoints: number;
  createdAt: string;
  activatedAt: string | null;
  lastInteractionAt: string | null;
  expiresAt: string | null;
  ageDays: number;
  decayed: boolean;
  explanation: string;
}

/** Relationship earned through exchanges both members confirmed. Distinct from vouches: no liability. */
export interface EarnedEdgeView {
  id: string;
  memberAId: string;
  memberBId: string;
  strength: number;
  effectiveStrength: number;
  status: 'ACTIVE' | 'EXPIRED';
  decayed: boolean;
  countedExchanges: number;
  createdAt: string;
  lastExchangeAt: string;
  explanation: string;
}

export interface TrustUpdateView {
  id: string;
  relationshipId: string;
  exchangeId: string;
  exchangeDeliverable?: string;
  members: [MemberSummary, MemberSummary];
  previousStrength: number;
  newStrength: number;
  applied: boolean;
  reason: string;
  relationshipTrustBefore: number | null;
  relationshipTrustAfter: number | null;
  ruleId: string;
  createdAt: string;
}

export interface GraphView {
  nodes: (MemberSummary & { connected: boolean; componentSize: number })[];
  edges: EdgeView[];
  earnedEdges: EarnedEdgeView[];
  rules: { decayAfterMonths: number; decayFactor: number; expireAfterMonths: number; undirectedNote: string };
  now: string;
}

export interface PathStep {
  from: MemberSummary;
  to: MemberSummary;
  /** Vouch between the two (null if they are linked only by an earned relationship). */
  edge: EdgeView | null;
  earned: EarnedEdgeView | null;
  /** Combined pair strength used on the path: 1 − (1 − vouch)(1 − earned). */
  strength: number;
  kind: 'vouch' | 'earned' | 'both';
  /** true when the walk follows voucher -> vouchee; false when it walks the edge backwards. */
  forward: boolean;
}

export interface PathResult {
  found: boolean;
  hops: number | null;
  strength: number | null;
  members: MemberSummary[];
  steps: PathStep[];
  calculation: string;
  explanation: string;
  tieBreak: string;
  /** Fewest hops over active vouches only (navigation / attestor distance), independent of strength. */
  fewestVouchHops?: number | null;
}

export interface ListingView {
  id: string;
  type: ListingType;
  title: string;
  description: string;
  category: string;
  owner: MemberSummary;
  durationMinutes: number;
  locationType: LocationType;
  location: string;
  availability: string;
  requiredSkills: string[];
  tags: string[];
  status: ListingStatus;
  createdAt: string;
  trustTier: TrustTier;
  minCredibility: number | null;
  minRelationshipTrust: number | null;
  maxCreditBudget: number | null;
  reachability?: { reachable: boolean; hops: number | null; strength: number | null };
  /** For requests by others: can the viewer take this task (computed by the eligibility module). */
  eligibility?: TaskEligibilityView | null;
  /** Price estimate from the pricing module (provider = owner for offers, viewer for requests). */
  priceEstimate?: PriceBreakdown | null;
}

export interface EligibilityCheck {
  key: 'memberActive' | 'credibility' | 'relationshipTrust' | 'verifiedContact' | 'ownerApproval';
  label: string;
  passed: boolean;
  /** Owner approval can be pending without the member being locked out. */
  pending?: boolean;
  required: string;
  current: string;
  explanation: string;
}

export interface TaskEligibilityView {
  tier: TrustTier;
  tierLabel: string;
  tierExamples: string;
  /** All checks pass (including owner approval when it is evaluated). */
  eligible: boolean;
  /** A member requirement fails (score, relationship trust, verification). Owner approval alone never locks. */
  locked: boolean;
  requiredCredibility: number;
  currentCredibility: number;
  requirementSources: { tierMinimum: number; categoryMinimum: number; requesterMinimum: number | null };
  requiredRelationshipTrust: number | null;
  currentRelationshipTrust: number | null;
  checks: EligibilityCheck[];
  conditions: string[];
  howToBecomeEligible: string[];
  summary: string;
}

export interface PriceBreakdown {
  durationMinutes: number;
  baseCredits: number;
  skill: { tier: SkillTier; multiplierPct: number; source: 'default' | 'peer-reviewed'; reason: string };
  demand: {
    multiplierPct: number;
    status: 'APPLIED' | 'INSUFFICIENT_DATA' | 'WAITING_FOR_PROVIDER';
    reason: string;
    inputs: { uniqueActiveRequests: number; availableProviders: number; ratio: number | null; windowDays: number; excludedExpired: number; excludedDuplicates: number };
  };
  serviceCredits: number;
  giftBonus: number;
  total: number;
  maxCreditBudget: number | null;
  withinBudget: boolean;
  formula: string;
  calculation: string;
  rounding: string;
  quotedAt: string;
  lockedAt: string | null;
  policyVersion: string;
  legacy?: boolean;
}

export interface ReservationView {
  id: string;
  status: ReservationStatus;
  amount: number;
  giftBonus: number;
  total: number;
  payerId: string;
  payeeId: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface TimelineEntry {
  id: string;
  at: string;
  actor: string | null;
  action: string;
  summary: string;
  module: string;
}

export interface ExchangeView {
  id: string;
  status: ExchangeStatus;
  listingId: string | null;
  linkedExchangeId: string | null;
  provider: MemberSummary;
  recipient: MemberSummary;
  proposer: MemberSummary;
  myRole: 'provider' | 'recipient' | 'observer';
  deliverable: string;
  category: string;
  durationMinutes: number;
  scheduledAt: string;
  location: string;
  punctualityRequired: boolean;
  creditAmount: number;
  giftBonus: number;
  cancellationNoticeHours: number;
  cancellationTerms: string;
  confirmationDeadline: string;
  termsVersion: number;
  providerAcceptedAt: string | null;
  recipientAcceptedAt: string | null;
  acceptedAt: string | null;
  providerConfirmedAt: string | null;
  recipientConfirmedAt: string | null;
  settledAt: string | null;
  settledAmount: number | null;
  cancelRequestedById: string | null;
  partialAmount: number | null;
  partialProposedById: string | null;
  partialNote: string | null;
  createdAt: string;
  trustTier: TrustTier;
  minCredibility: number | null;
  minRelationshipTrust: number | null;
  maxCreditBudget: number | null;
  homeAccess: { required: boolean; approved: boolean; approvedAt: string | null };
  /** Quote (before acceptance) or locked snapshot (after). Legacy exchanges get a 1h = 1 credit breakdown. */
  pricing: PriceBreakdown | null;
  priceLocked: boolean;
  reservation: ReservationView | null;
  disputeId: string | null;
  /** Backend-computed list of actions available to the viewer, with reasons for blocked ones. */
  actions: { key: string; allowed: boolean; reason: string | null }[];
}

export interface CreditLotView {
  id: string;
  earnedAt: string;
  expiresAt: string;
  originalAmount: number;
  remaining: number;
  expired: boolean;
  protectedByReservation: number;
}

export interface CreditSummary {
  memberId: string;
  posted: number;
  reservedOutgoing: number;
  available: number;
  pendingIncoming: number;
  disputedOutgoing: number;
  disputedIncoming: number;
  floor: number;
  headroom: number;
  explanation: { posted: string; available: string; floor: string };
  reservations: (ReservationView & { exchangeId: string; deliverable: string; direction: 'outgoing' | 'incoming' })[];
  lots: CreditLotView[];
  expiry: { implemented: true; nextExpiryAt: string | null; expiringWithin30Days: number; note: string };
}

export interface LedgerEntryView {
  id: string;
  transactionId: string;
  kind: string;
  amount: number;
  explanation: string;
  effectiveAt: string;
  exchangeId: string | null;
  ruleId: string;
  counterparty: string;
  runningBalance: number;
}

export interface CredibilityFactor {
  key: 'completedServices' | 'confirmationRate' | 'incomingVouches' | 'disputeOutcomes' | 'attestation';
  label: string;
  points: number;
  maxPoints: number | null;
  inputs: Record<string, number | string>;
  calculation: string;
}

export interface CredibilityView {
  memberId: string;
  score: number;
  factors: CredibilityFactor[];
  formula: string;
  noHistoryNote: string;
  permissions: PermissionCheck[];
  history: { id: string; score: number; reason: string; createdAt: string; delta: number }[];
  penalties: { id: string; kind: string; points: number; finding: string; createdAt: string; disputeId: string | null }[];
  disclaimer: string;
}

export interface EligibilityRow {
  member: MemberSummary;
  eligible: boolean;
  reasons: string[];
  distanceToParties: { [memberId: string]: number | null };
  score: number;
  /** Relationship trust (strongest path) to each party, and closeness = the max of the two. */
  closeness: { toParties: { [memberId: string]: number }; value: number } | null;
  rank: number | null;
  selectionReason: string | null;
}

export interface AttestorSelectionView {
  id: string;
  round: number;
  seed: string;
  method: string;
  requiredCount: number;
  sufficient: boolean;
  selected: MemberSummary[];
  candidates: EligibilityRow[];
  createdAt: string;
}

export interface AssignmentView {
  id: string;
  round: number;
  attestor: MemberSummary;
  selectionReason: string | null;
  status: AssignmentStatus;
  vote: VoteChoice | null;
  reason: string | null;
  votedAt: string | null;
}

export interface DisputeView {
  id: string;
  exchangeId: string;
  exchange: ExchangeView;
  openedBy: MemberSummary;
  condition: DisputeCondition;
  claim: string;
  status: DisputeStatus;
  stage: number;
  outcome: DisputeOutcome | null;
  outcomeSource: string | null;
  reviewReason: string | null;
  nextAction: string | null;
  voteDeadline: string | null;
  mutualProposal: { byId: string; outcome: DisputeOutcome } | null;
  createdAt: string;
  resolvedAt: string | null;
  evidence: { id: string; author: MemberSummary; kind: string; content: string; createdAt: string }[];
  selections: AttestorSelectionView[];
  assignments: AssignmentView[];
  myAssignment: AssignmentView | null;
  effects: { kind: string; description: string }[];
  independenceNote: string;
  timeline: TimelineEntry[];
}

export interface AuditEventView {
  id: string;
  occurredAt: string;
  recordedAt: string;
  actor: MemberSummary | null;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string;
  ruleId: string;
  policyVersion: string;
  correlationId: string;
  summary: string;
}

export interface InvitationView {
  id: string;
  code: string;
  inviter: MemberSummary;
  inviteeName: string;
  strength: number;
  liabilityPct: number;
  maxPenaltyPoints: number;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  terms: string[];
}

export interface VouchAmendmentView {
  id: string;
  vouchId: string;
  proposedById: string;
  fromStrength: number;
  toStrength: number;
  fromLiabilityPct: number;
  toLiabilityPct: number;
  increasesLiability: boolean;
  status: string;
  createdAt: string;
}

export interface DemoGuideStep {
  n: number;
  title: string;
  done: boolean;
  actAs: string | null;
  instruction: string;
  where: string;
}

export interface SkillTierView {
  category: string;
  tier: SkillTier;
  multiplierPct: number;
  source: 'default' | 'peer-reviewed';
  reason: string;
}

export interface SkillClaimView {
  id: string;
  member: MemberSummary;
  category: string;
  tier: SkillTier;
  evidence: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  requiredApprovals: number;
  approvals: number;
  reviews: { reviewer: MemberSummary; approve: boolean; note: string; createdAt: string }[];
  /** Evidence from records shown to reviewers. */
  record: { settledServices: number; nonperformanceFindings: number };
  createdAt: string;
  decidedAt: string | null;
  canReview: boolean;
  cannotReviewReason: string | null;
}

export interface VerificationStatus {
  /** DEMO_VERIFIED: demo mode only — the code was shown in an on-screen preview, not delivered by email. */
  status: 'VERIFIED' | 'DEMO_VERIFIED' | 'UNVERIFIED' | 'NOT_PROVIDED' | 'UNAVAILABLE';
  verifiedAt: string | null;
  note: string;
}

/** Profile with privacy applied for the viewer. selfReported is never shown as verified. */
export interface ProfileView {
  member: MemberSummary;
  isMe: boolean;
  selfReported: {
    displayName: string;
    photoUrl: string | null;
    intro: string;
    affiliation: string;
    neighborhood: string;
    languages: string[];
    skills: string[];
    availability: string;
  };
  verification: { email: VerificationStatus; phone: VerificationStatus };
  fromRecords: {
    joinedAt: string;
    completedServiceCount: number;
    credibility: { score: number; factors: CredibilityFactor[] };
    skillTiers: SkillTierView[];
  };
  /** Only for the member themselves, or exchange partners when sharing is enabled. */
  contact: { email: string | null; phone: string | null; visibility: string } | null;
  /** Only for the member themselves. */
  private: { loginEmail: string; homeAddress: string | null; shareContactWithPartners: boolean; juryAvailable: boolean } | null;
  privacyNote: string;
}

export interface NotificationView {
  id: string;
  kind: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
  email: { status: EmailStatus; provider: string } | null;
}

export interface EmailOutboxView {
  id: string;
  toAddress: string;
  subject: string;
  body: string;
  status: EmailStatus;
  provider: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  categories: NotificationCategory[];
  allCategories: { key: NotificationCategory; label: string }[];
  address: string | null;
  addressVerified: boolean;
  delivery: { mode: 'preview' | 'smtp' | 'disabled'; note: string };
}
