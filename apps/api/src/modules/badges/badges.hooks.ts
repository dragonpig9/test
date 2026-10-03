import type { Ctx } from '../../core/context';
import { afterCommit, withTx } from '../../core/db';
import { evaluateBadges } from './badges.service';

/**
 * Called by the exchanges module when an exchange settles. Runs AFTER the settlement commits, in its
 * own transaction: a badge problem can never undo or delay a settlement, and the settlement itself is
 * already idempotent (one ledger transaction per exchange), so retries cannot award twice either.
 */
export function onExchangeSettled(ctx: Ctx, providerId: string, recipientId: string) {
  afterCommit(async () => {
    await withTx((tx) => evaluateBadges(tx, ctx, [providerId, recipientId]));
  });
}
