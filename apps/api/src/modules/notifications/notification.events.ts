import type { NotificationCategory } from '@commonhours/shared';
import { afterCommit } from '../../core/db';

/**
 * What other modules call to notify someone. The intent is held until the business
 * transaction commits (core/db `afterCommit`), so a rolled-back change never notifies anyone
 * and a notification/email failure can never undo a committed change.
 */
export interface NotificationIntent {
  memberId: string;
  kind: string;
  category: NotificationCategory;
  title: string;
  /** In-app text. Never put dispute evidence or exact home addresses here. */
  body: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  /** Same event → same key → at most one notification (and one email). */
  dedupeKey: string;
  /** Domain time of the event. */
  at: Date;
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  invitations: 'Invitations and vouch requests',
  exchanges: 'Task proposals, acceptance and cancellation',
  reminders: 'Upcoming services and confirmation requests',
  credits: 'Credit settlement',
  trust: 'Trust changes and newly unlocked tasks',
  disputes: 'Disputes and outcomes',
  jury: 'Jury assignments and voting deadlines',
  community: 'Community pool and friends who could use an opportunity',
};

export function notify(intent: NotificationIntent | NotificationIntent[]) {
  const list = Array.isArray(intent) ? intent : [intent];
  if (!list.length) return;
  afterCommit(async () => {
    const { createNotifications } = await import('./notification.service');
    await createNotifications(list);
  });
}
