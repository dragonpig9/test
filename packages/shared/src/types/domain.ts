// Domain enums shared by API and web. They mirror the Prisma enums.
export type MemberStatus = 'ACTIVE' | 'LEFT';
export type VouchStatus = 'PENDING' | 'ACTIVE' | 'DECLINED' | 'EXPIRED' | 'REVOKED';
export type InvitationStatus = 'OPEN' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
export type ListingType = 'OFFER' | 'REQUEST';
export type ListingStatus = 'OPEN' | 'WITHDRAWN' | 'CLOSED';
export type LocationType = 'ONLINE' | 'IN_PERSON';
export type ExchangeStatus =
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'DISPUTED'
  | 'SETTLED'
  | 'RELEASED'
  | 'CANCELLED'
  | 'DECLINED'
  | 'WITHDRAWN';
export type ReservationStatus = 'ACTIVE' | 'FROZEN' | 'SETTLED' | 'RELEASED';
export type DisputeStatus = 'AWAITING_ATTESTATION' | 'PANEL_REVIEW' | 'NEEDS_REVIEW' | 'RESOLVED';
export type DisputeOutcome = 'CONFIRMED' | 'REFUTED';
export type DisputeCondition = 'DELIVERABLE' | 'DURATION' | 'PUNCTUALITY' | 'NO_SHOW';
export type VoteChoice = 'CONFIRMED' | 'REFUTED' | 'UNCLEAR';
export type AssignmentStatus = 'ASSIGNED' | 'VOTED' | 'RECUSED' | 'MISSED' | 'NOT_NEEDED';
