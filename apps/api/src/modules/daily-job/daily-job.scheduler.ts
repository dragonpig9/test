import { readClock } from '../../core/context';
import { prisma } from '../../core/db';
import { runDueDailyJob } from './daily-job.service';

/**
 * In-process scheduler: checks once a minute (and once at start-up) whether the run for the current
 * Hong Kong date (00:00 Asia/Hong_Kong on the domain clock) has completed, and runs it if not. No user
 * needs to open the website. A run missed while the server was down is caught up on the next check.
 * Multiple API instances are safe: the unique DailyJobRun row lets only one of them run a date.
 *
 * Hosts that sleep idle services (e.g. Render free plan) should run scripts/run-daily-job.ts from a
 * cron job instead and set DAILY_JOB_SCHEDULER=false.
 */
const CHECK_MS = 60_000;
let running = false;

async function check() {
  if (running) return;
  running = true;
  try {
    const now = await readClock(prisma);
    const r = await runDueDailyJob(now, 'scheduler');
    if (r.ran) console.log(`[daily-job] ${r.run.runDate}: ${r.run.status}`);
  } catch (e) {
    console.error('[daily-job] scheduler check failed:', e);
  } finally {
    running = false;
  }
}

export function startDailyJobScheduler() {
  void check();
  setInterval(() => void check(), CHECK_MS).unref();
}
