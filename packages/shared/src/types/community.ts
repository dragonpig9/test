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

export interface LeaderboardEntry {
  rank: number;
  member: MemberSummary;
  university: string | null;
  points: number;
  distinctCounterparties: number;
  isMe: boolean;
}

export interface ActivityWindowView {
  startDay: string;
  endDay: string;
  days: number;
  timezone: string;
}

export interface LeaderboardView {
  window: ActivityWindowView;
  entries: LeaderboardEntry[];
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
