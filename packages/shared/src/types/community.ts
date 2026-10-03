import type { AccountType } from './domain';
import type { MemberSummary } from './dto';

/** Student account details (only for the member themselves, except `university`, which is public). */
export interface StudentStatusView {
  accountType: AccountType;
  university: { code: string; name: string; domain: string } | null;
  studentEmail: string | null;
  /** "VERIFIED" only after a delivered code was confirmed; "DEMO_VERIFIED" = development-only preview. */
  emailVerification: 'VERIFIED' | 'DEMO_VERIFIED' | 'PENDING' | 'NOT_PROVIDED';
  emailVerifiedAt: string | null;
  /** Self-declared current enrolment; separate from email ownership. */
  declaredCurrentStudentAt: string | null;
  notes: string[];
  /** Development-only: codes are shown in the on-screen email preview instead of being emailed. */
  devPreviewDelivery: boolean;
}

/** Admission and verification state for the signed-in member (GET /auth/me). */
export interface AdmissionView {
  /** Server-side DEMO_MODE flag (read-only for clients). */
  demoMode: boolean;
  admitted: boolean;
  admittedVia: 'INVITATION' | 'VERIFIED_EMAIL' | 'DEMO_BYPASS' | null;
  /** Normal mode only: show the verification screen instead of the app. */
  verificationRequired: boolean;
  studentVerificationPending: boolean;
  /** False in demo mode: no verification banners or prompts. */
  showVerificationPrompts: boolean;
  universityAccess: { university: string | null; allowed: boolean; via: 'VERIFIED_EMAIL' | 'DEMO_SELF_DECLARED' | null; reason: string };
  /** "Demo student" / "Demo member" for accounts admitted through the demo bypass; never a verified badge. */
  demoBadge: 'Demo student' | 'Demo member' | null;
}

export interface CircleSummaryView {
  code: string;
  name: string;
  universityName: string;
  memberCount: number;
}

export interface MyCircleView {
  /** The member's university circle (null = no university on the profile). */
  circle: CircleSummaryView | null;
  allowed: boolean;
  via: 'VERIFIED_EMAIL' | 'DEMO_SELF_DECLARED' | null;
  reason: string;
  /** Rooms this member previously belonged to (history kept; no access). */
  formerCircles: { code: string; name: string; leftAt: string; leftReason: string | null }[];
  tags: string[];
}

export interface CircleMessageView {
  id: string;
  author: MemberSummary;
  body: string;
  tags: string[];
  createdAt: string;
  mine: boolean;
}

export interface CircleRoomView {
  circle: CircleSummaryView;
  via: 'VERIFIED_EMAIL' | 'DEMO_SELF_DECLARED';
  messages: CircleMessageView[];
  tag: string | null;
  tags: string[];
  note: string;
}

export interface ActivityWindowView {
  startDay: string;
  endDay: string;
  days: number;
  timezone: string;
}

export type BadgeKind = 'FIRST_EXCHANGE' | 'COMMUNITY_REGULAR';

/** Recognition only: no credits, prices, limits, credibility, relationship strength or privileges. */
export interface BadgeView {
  kind: BadgeKind;
  label: 'First Exchange' | 'Community Regular';
  description: string;
  /** "once" or "YYYY-MM" */
  period: string;
  /** e.g. "October 2026" for monthly badges; null for one-time badges. */
  periodLabel: string | null;
  awardedAt: string;
}

export interface MyBadgesView {
  badges: BadgeView[];
  showBadges: boolean;
  definitions: { kind: BadgeKind; label: string; description: string }[];
  note: string;
}

export interface FriendsActivityEntry {
  /** Equal points → equal rank (1, 1, 3). */
  rank: number;
  member: MemberSummary;
  university: string | null;
  /** Capped activity points for the month. Separate from credits, credibility and relationship strength. */
  points: number;
  /** Hundredths of a credit, from settled service-credit transfers (gifts, pool rewards, expiry and adjustments excluded). */
  creditsEarned: number;
  creditsSpent: number;
  isMe: boolean;
}

export interface FriendsActivityView {
  label: 'Friends activity';
  year: number;
  /** 1–12 */
  month: number;
  monthName: string;
  timezone: string;
  /** Inclusive local dates of the month. */
  startDay: string;
  endDay: string;
  isCurrentMonth: boolean;
  years: number[];
  entries: FriendsActivityEntry[];
  /** Short scoring explanation for the tooltip. */
  rules: string[];
  generatedAt: string;
}

export interface PoolDistributionView {
  runDate: string;
  status: 'PAID' | 'RETAINED_NO_ACTIVE_USERS' | 'RETAINED_TOO_SMALL';
  poolBefore: number;
  activeUserCount: number;
  recipientCount: number;
  paymentPerRecipient: number;
  totalPaid: number;
  remaining: number;
  window: ActivityWindowView;
  createdAt: string;
  explanation: string;
}

export interface CommunityPoolView {
  balance: number;
  timezone: string;
  nextRunAt: string;
  lastDistribution: PoolDistributionView | null;
  recent: PoolDistributionView[];
  myLastGrant: { runDate: string; amount: number } | null;
  rules: string[];
}

export interface DailyJobRunView {
  runDate: string;
  status: string;
  trigger: string;
  attempts: number;
  scheduledFor: string;
  completedAt: string | null;
  lastError: string | null;
  steps: unknown;
}
