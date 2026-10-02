import { z } from 'zod';
import { LIABILITY_OPTIONS, SERVICE_CATEGORIES, VOUCH_STRENGTHS } from '../constants';

// Request body schemas used by the API (authoritative) and by web forms (early feedback).

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const strengthSchema = z.number().refine((v) => (VOUCH_STRENGTHS as readonly number[]).includes(v), {
  message: 'Strength must be 0.4, 0.7 or 1.0',
});
const liabilitySchema = z.number().int().refine((v) => (LIABILITY_OPTIONS as readonly number[]).includes(v), {
  message: 'Liability must be 10, 25 or 50 percent',
});

export const joinSchema = z.object({
  code: z.string().min(4),
  displayName: z.string().min(2).max(60),
  handle: z.string().regex(/^[a-z0-9_-]{2,24}$/, 'Lowercase letters, digits, - or _'),
  email: z.string().email(),
  password: z.string().min(8, 'At least 8 characters'),
  acceptCommunityTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the community terms' }) }),
  acceptVouchTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the vouch terms' }) }),
});

export const createInvitationSchema = z.object({
  inviteeName: z.string().min(2).max(60),
  strength: strengthSchema,
  liabilityPct: liabilitySchema,
  acknowledgeLiability: z.literal(true, { errorMap: () => ({ message: 'Confirm you understand the liability' }) }),
});

export const proposeVouchSchema = z.object({
  voucheeId: z.string().min(1),
  strength: strengthSchema,
  liabilityPct: liabilitySchema,
  acknowledgeLiability: z.literal(true, { errorMap: () => ({ message: 'Confirm you understand the liability' }) }),
});

export const amendVouchSchema = z.object({
  strength: strengthSchema,
  liabilityPct: liabilitySchema,
});

export const revokeSchema = z.object({ reason: z.string().min(3).max(500) });

export const createListingSchema = z.object({
  type: z.enum(['OFFER', 'REQUEST']),
  title: z.string().min(3).max(100),
  description: z.string().min(3).max(2000),
  category: z.enum(SERVICE_CATEGORIES),
  durationMinutes: z.number().int().min(15).max(8 * 60),
  locationType: z.enum(['ONLINE', 'IN_PERSON']),
  location: z.string().max(120).default(''),
  availability: z.string().min(2).max(200),
  requiredSkills: z.array(z.string().min(1).max(40)).max(10).default([]),
});

export const exchangeTermsSchema = z.object({
  deliverable: z.string().min(3).max(1000),
  durationMinutes: z.number().int().min(15).max(8 * 60),
  scheduledAt: z.string().datetime(),
  location: z.string().max(120).default(''),
  punctualityRequired: z.boolean(),
  giftBonus: z.number().int().min(0).max(1000).default(0),
  cancellationNoticeHours: z.number().int().min(0).max(24 * 14),
  cancellationTerms: z.string().max(500).default(''),
  confirmationDays: z.number().int().min(1).max(14).default(3),
});

export const proposeExchangeSchema = exchangeTermsSchema.extend({
  listingId: z.string().optional(),
  counterpartyId: z.string().min(1),
  /** Role of the proposer in this exchange. */
  myRole: z.enum(['provider', 'recipient']),
  category: z.enum(SERVICE_CATEGORIES),
  linkedExchangeId: z.string().optional(),
});

export const acceptExchangeSchema = z.object({ termsVersion: z.number().int().min(1) });
export const cancelExchangeSchema = z.object({ reason: z.string().min(3).max(500) });
export const partialSchema = z.object({ amount: z.number().int().min(1), note: z.string().min(3).max(500) });

export const openDisputeSchema = z.object({
  exchangeId: z.string().min(1),
  condition: z.enum(['DELIVERABLE', 'DURATION', 'PUNCTUALITY', 'NO_SHOW']),
  claim: z.string().min(10).max(2000),
});

export const evidenceSchema = z.object({
  kind: z.enum(['STATEMENT', 'LINK', 'NOTE']),
  content: z.string().min(3).max(2000),
});

export const voteSchema = z.object({
  vote: z.enum(['CONFIRMED', 'REFUTED', 'UNCLEAR']),
  reason: z.string().min(10, 'Give a reason of at least 10 characters').max(2000),
});

export const recuseSchema = z.object({ reason: z.string().min(5).max(500) });

export const mutualResolutionSchema = z.object({ outcome: z.enum(['CONFIRMED', 'REFUTED']) });

export const conflictSchema = z.object({
  otherMemberId: z.string().min(1),
  reason: z.string().min(3).max(300),
});

export const leaveSchema = z.object({
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that you want to leave' }) }),
  reason: z.string().max(500).default(''),
});

export const advanceClockSchema = z.object({ days: z.number().int().min(1).max(800) });
export const switchAccountSchema = z.object({ handle: z.string().min(1) });

export type LoginInput = z.infer<typeof loginSchema>;
export type JoinInput = z.infer<typeof joinSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type ProposeVouchInput = z.infer<typeof proposeVouchSchema>;
export type AmendVouchInput = z.infer<typeof amendVouchSchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type ExchangeTermsInput = z.infer<typeof exchangeTermsSchema>;
export type ProposeExchangeInput = z.infer<typeof proposeExchangeSchema>;
export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;
export type EvidenceInput = z.infer<typeof evidenceSchema>;
export type VoteInput = z.infer<typeof voteSchema>;
