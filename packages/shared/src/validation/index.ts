import { z } from 'zod';
import { LIABILITY_OPTIONS, SERVICE_CATEGORIES, TOPIC_TAGS, VOUCH_STRENGTHS } from '../constants';
import { studentDetailsSchema } from './student';

// Request body schemas used by the API (authoritative) and by web forms (early feedback).

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const strengthSchema = z.number().refine((v) => (VOUCH_STRENGTHS as readonly number[]).includes(v), {
  message: 'Strength must be 0.4, 0.7 or 1.0',
});
const liabilitySchema = z.number().int().refine((v) => (LIABILITY_OPTIONS as readonly number[]).includes(v), {
  message: 'Liability must be 10, 20 or 30 percent',
});

export const joinSchema = z.object({
  code: z.string().min(4),
  displayName: z.string().min(2).max(60),
  handle: z.string().regex(/^[a-z0-9_-]{2,24}$/, 'Lowercase letters, digits, - or _'),
  email: z.string().email(),
  password: z.string().min(8, 'At least 8 characters'),
  acceptCommunityTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the community terms' }) }),
  acceptVouchTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the vouch terms' }) }),
  /** "Register as a student": the university email becomes the login email and must be verified. */
  student: studentDetailsSchema.optional(),
});

/**
 * "Join as a student": no invitation code anywhere (frontend, backend or database). The university
 * email (username + the university's fixed suffix) is the login email; the API re-checks the domain.
 */
export const studentJoinSchema = z.object({
  displayName: z.string().min(2).max(60),
  handle: z.string().regex(/^[a-z0-9_-]{2,24}$/, 'Lowercase letters, digits, - or _'),
  password: z.string().min(8, 'At least 8 characters'),
  acceptCommunityTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the community terms' }) }),
  student: studentDetailsSchema,
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

const trustTierSchema = z.enum(['STANDARD', 'RESTRICTED', 'HIGH_TRUST']);
const requirementFields = {
  trustTier: trustTierSchema.optional(),
  minCredibility: z.number().int().min(0).max(100).nullable().optional(),
  minRelationshipTrust: z.number().min(0).max(1).nullable().optional(),
  maxCreditBudget: z.number().int().min(1).max(5000).nullable().optional(),
};

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
  /** Topic tags for discovery (optional). */
  tags: z.array(z.enum(TOPIC_TAGS)).max(TOPIC_TAGS.length).optional(),
  ...requirementFields,
});

export const badgeVisibilitySchema = z.object({ showBadges: z.boolean() });

export const circleMessageSchema = z.object({
  body: z.string().trim().min(1, 'Write a message').max(1000),
  tags: z.array(z.enum(TOPIC_TAGS)).max(TOPIC_TAGS.length).default([]),
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
  ...requirementFields,
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

export const homeAccessSchema = z.object({
  termsVersion: z.number().int().min(1),
  acknowledge: z.literal(true, { errorMap: () => ({ message: 'Confirm that you grant home access for this exchange' }) }),
});

export const skillClaimSchema = z.object({
  category: z.enum(SERVICE_CATEGORIES),
  tier: z.enum(['SKILLED', 'ADVANCED', 'SPECIALIST']),
  evidence: z.string().min(10, 'Describe your experience or qualification (at least 10 characters)').max(1000),
});

export const skillReviewSchema = z.object({
  approve: z.boolean(),
  note: z.string().min(5).max(500),
});

const optionalText = (max: number) => z.string().trim().max(max);
export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  photoUrl: z.union([z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'Photo URL must start with https://'), z.literal('')]).optional(),
  intro: optionalText(500),
  affiliation: optionalText(120),
  neighborhood: optionalText(80),
  languages: z.array(z.string().trim().min(1).max(40)).max(10),
  skills: z.array(z.string().trim().min(1).max(40)).max(15),
  availability: optionalText(200),
  contactEmail: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
  phone: z.union([z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'Use digits, spaces, +, ( ) or -'), z.literal('')]).optional(),
  homeAddress: optionalText(300).optional(),
  shareContactWithPartners: z.boolean(),
  juryAvailable: z.boolean(),
});

export const verifyEmailSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const NOTIFICATION_CATEGORIES = ['invitations', 'exchanges', 'reminders', 'credits', 'trust', 'disputes', 'jury', 'community'] as const;
export const notificationPrefsSchema = z.object({
  emailEnabled: z.boolean(),
  categories: z.array(z.enum(NOTIFICATION_CATEGORIES)).max(NOTIFICATION_CATEGORIES.length),
});

export const advanceClockSchema = z.object({ days: z.number().int().min(1).max(800) });
export const switchAccountSchema = z.object({ handle: z.string().min(1) });

export * from './student';

export type LoginInput = z.infer<typeof loginSchema>;
export type JoinInput = z.infer<typeof joinSchema>;
export type StudentJoinInput = z.infer<typeof studentJoinSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type ProposeVouchInput = z.infer<typeof proposeVouchSchema>;
export type AmendVouchInput = z.infer<typeof amendVouchSchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type ExchangeTermsInput = z.infer<typeof exchangeTermsSchema>;
export type ProposeExchangeInput = z.infer<typeof proposeExchangeSchema>;
export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;
export type EvidenceInput = z.infer<typeof evidenceSchema>;
export type VoteInput = z.infer<typeof voteSchema>;
export type CircleMessageInput = z.infer<typeof circleMessageSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type SkillClaimInput = z.infer<typeof skillClaimSchema>;
