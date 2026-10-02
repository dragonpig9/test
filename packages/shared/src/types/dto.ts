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
  ReservationStatus,
  VoteChoice,
  VouchStatus,
} from './domain';

export interface MemberSummary {
  id: string;
  handle: string;
  displayName: string;
  status: MemberStatus;
  isBootstrap: boolean;
}

export interface MemberProfile extends MemberSummary {
  bio: string;
  skills: string[];
  location: string;
  joinedAt: string;
  leftAt: string | null;
}

export interface PermissionCheck {
  key: 'invite' | 'vouch' | 'attest' | 'noGuarantorNeeded' | 'restrictedCategories';
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

export interface GraphView {
  nodes: (MemberSummary & { connected: boolean; componentSize: number })[];
  edges: EdgeView[];
  rules: { decayAfterMonths: number; decayFactor: number; expireAfterMonths: number; undirectedNote: string };
  now: string;
}

export interface PathStep {
  from: MemberSummary;
  to: MemberSummary;
  edge: EdgeView;
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
  status: ListingStatus;
  createdAt: string;
  reachability?: { reachable: boolean; hops: number | null; strength: number | null };
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
}

export interface AttestorSelectionView {
  id: string;
  round: number;
  seed: string;
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
