import { Prisma, type DailyJobRun } from '@prisma/client';
import type { DailyJobRunView } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import { makeCtx } from '../../core/context';
import { prisma, withTx, type Db } from '../../core/db';
import { distributePool } from '../community-pool/community-pool.service';
import { runCreditExpiry } from '../expiry/expiry.service';
import { sendNegativeBalanceReminders, syncNegativePeriods } from '../negative-balance/negative-balance.service';
import { currentRun, runsBetween, type DueRun } from './daily-job.schedule';

/**
 * Daily job orchestration (00:00 Asia/Hong_Kong). Order matters:
 *   1. expire eligible credits into the Community Credit Pool
 *   2. snapshot activity and distribute the pool
 *   3. negative-balance periods + close-friend reminders (AFTER redistribution, which may have
 *      brought someone back to ≥ 0)
 * Each step is its own transaction and idempotent; the DailyJobRun row (unique per date) records
 * progress. A FAILED or crashed (stale RUNNING) run is re-claimed and simply re-runs every step:
 * expiry finds nothing already expired, the distribution for that date already exists, and
 * reminders already sent are skipped — so retries never expire twice, pay twice or notify twice.
 */
const S = POLICY.schedule;
export type JobTrigger = 'scheduler' | 'clock-advance' | 'manual' | 'cli';

export function toRunView(r: DailyJobRun): DailyJobRunView {
  return {
    runDate: r.runDate,
    status: r.status,
    trigger: r.trigger,
    attempts: r.attempts,
    scheduledFor: r.scheduledFor.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    lastError: r.lastError,
    steps: r.steps,
  };
}

/** Claims the run record for `due.runDate`. Returns null when it is completed or another worker holds it. */
async function claim(due: DueRun, trigger: JobTrigger): Promise<DailyJobRun | null> {
  let r = await prisma.dailyJobRun.findUnique({ where: { runDate: due.runDate } });
  if (!r) {
    try {
      return await prisma.dailyJobRun.create({ data: { runDate: due.runDate, scheduledFor: due.scheduledFor, status: 'RUNNING', trigger, startedAt: new Date() } });
    } catch (e) {
      // Another worker created it first (unique runDate).
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      r = await prisma.dailyJobRun.findUniqueOrThrow({ where: { runDate: due.runDate } });
    }
  }
  if (r.status === 'COMPLETED') return null;
  const stale = r.status === 'FAILED' || r.startedAt.getTime() < Date.now() - S.staleRunMinutes * 60_000;
  if (!stale) return null;
  const u = await prisma.dailyJobRun.updateMany({
    where: { id: r.id, status: r.status, startedAt: r.startedAt },
    data: { status: 'RUNNING', trigger, attempts: { increment: 1 }, startedAt: new Date(), lastError: null },
  });
  return u.count === 1 ? prisma.dailyJobRun.findUniqueOrThrow({ where: { id: r.id } }) : null;
}

/**
 * Runs the job for one date. `now` is the domain time the steps run at (the scheduled 00:00 for
 * catch-up runs, the current domain time for the live scheduler). Never throws for a step failure:
 * the run is marked FAILED with the error and retried on the next attempt.
 */
export async function runDailyJob(due: DueRun, opts: { trigger: JobTrigger; now?: Date }): Promise<{ run: DailyJobRunView; ran: boolean }> {
  const run = await claim(due, opts.trigger);
  if (!run) return { run: toRunView(await prisma.dailyJobRun.findUniqueOrThrow({ where: { runDate: due.runDate } })), ran: false };
  const now = opts.now ?? due.scheduledFor;
  const ctx = makeCtx(null, now, `daily-${due.runDate}-${run.attempts}`);
  const steps: Record<string, unknown> = {};
  const save = (data: Prisma.DailyJobRunUpdateInput) => prisma.dailyJobRun.update({ where: { id: run.id }, data });
  try {
    const expired = await withTx((tx) => runCreditExpiry(tx, ctx));
    steps.expiry = { members: expired.length, units: expired.reduce((s, e) => s + e.amount, 0) };
    await save({ steps: steps as Prisma.InputJsonValue });

    const dist = await withTx((tx) => distributePool(tx, ctx, due.runDate), { timeoutMs: 120_000 });
    const d = dist.distribution;
    steps.distribution = { alreadyDone: dist.alreadyDone, status: d.status, poolBefore: d.poolBefore, activeUsers: d.activeUserCount, recipients: d.recipientCount, paymentPerRecipient: d.paymentPerRecipient, totalPaid: d.totalPaid, remaining: d.remaining };
    await save({ steps: steps as Prisma.InputJsonValue });

    const nb = await withTx(async (tx) => ({ periods: await syncNegativePeriods(tx, ctx), reminders: await sendNegativeBalanceReminders(tx, ctx) }));
    steps.negativeBalance = nb;
    const done = await save({ status: 'COMPLETED', completedAt: new Date(), steps: steps as Prisma.InputJsonValue });
    return { run: toRunView(done), ran: true };
  } catch (e) {
    console.error(`[daily-job ${due.runDate}] failed (will be retried):`, e);
    const failed = await save({ status: 'FAILED', lastError: (e as Error).message.slice(0, 1000), steps: steps as Prisma.InputJsonValue });
    return { run: toRunView(failed), ran: true };
  }
}

/** The live scheduler and "Run daily job": run the job that is due at `now` if it has not completed. */
export function runDueDailyJob(now: Date, trigger: JobTrigger) {
  return runDailyJob(currentRun(now, S.timezone, S.dailyJobHour), { trigger, now });
}

/** Demo clock jumps: every 00:00 crossed in (from, to], oldest first, each at its own scheduled time. */
export async function runDailyJobsBetween(from: Date, to: Date, trigger: JobTrigger) {
  const out: DailyJobRunView[] = [];
  for (const due of runsBetween(from, to, S.timezone, S.dailyJobHour)) out.push((await runDailyJob(due, { trigger })).run);
  return out;
}

export async function recentRuns(db: Db, take = 14) {
  return (await db.dailyJobRun.findMany({ orderBy: { runDate: 'desc' }, take })).map(toRunView);
}
