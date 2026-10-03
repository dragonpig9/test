import { createApp } from './app';
import { env } from './config/env';
import { makeCtx, readClock } from './core/context';
import { prisma, withTx } from './core/db';
import { startDailyJobScheduler } from './modules/daily-job/daily-job.scheduler';
import { sweepReminders } from './modules/notifications/notification.reminders';
import { deliverOutbox, recoverStuckEmails } from './modules/notifications/notification.service';

createApp().listen(env.port, () => {
  console.log(`CommonHours API listening on http://localhost:${env.port} (demo mode: ${env.demoMode}, debug endpoints: ${env.debugEndpoints}, daily job scheduler: ${env.dailyJobScheduler})`);
});

// Daily job at 00:00 Asia/Hong_Kong (credit expiry → pool redistribution → negative-balance reminders).
if (env.dailyJobScheduler) startDailyJobScheduler();

/**
 * Background tick (every minute): reminders for upcoming services / vote deadlines and email
 * outbox retries. Errors are logged and never affect requests. Credit expiry runs in the daily
 * job (modules/daily-job) and on demo clock advance.
 */
const TICK_MS = 60_000;
setInterval(() => {
  void (async () => {
    try {
      const now = await readClock(prisma);
      await withTx((tx) => sweepReminders(tx, makeCtx(null, now, `tick-${Date.now()}`)));
      await recoverStuckEmails();
      await deliverOutbox();
    } catch (e) {
      console.error('[tick] background sweep failed:', e);
    }
  })();
}, TICK_MS).unref();
