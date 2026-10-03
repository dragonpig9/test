// Runs the daily job (credit expiry → community pool redistribution → negative-balance reminders)
// for the current Hong Kong date, if it has not completed yet. For hosts where an in-process timer
// is unreliable (e.g. services that sleep when idle): schedule this with an external cron at
// 00:00 Asia/Hong_Kong (= 16:00 UTC) and set DAILY_JOB_SCHEDULER=false on the web service.
// Safe to run repeatedly or concurrently: a completed date is a no-op.
//   npx tsx scripts/run-daily-job.ts
import { readClock } from '../src/core/context';
import { prisma } from '../src/core/db';
import { runDueDailyJob } from '../src/modules/daily-job/daily-job.service';

const r = await runDueDailyJob(await readClock(prisma), 'cli');
console.log(`Daily job ${r.run.runDate}: ${r.run.status}${r.ran ? '' : ' (already done or running elsewhere; nothing repeated)'}`, JSON.stringify(r.run.steps));
await prisma.$disconnect();
process.exit(r.run.status === 'FAILED' ? 1 : 0);
