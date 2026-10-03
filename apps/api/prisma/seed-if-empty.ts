// Seeds the demo community only when the database has no members yet.
// Used by the production start command so a fresh deploy has demo data without wiping later changes.
// It also recovers a demo preparation that never finished (FAILED, or INITIALIZING for so long that the
// process doing it must have died), and re-creates missing edge-case records in a READY demo community.
import { isDemoMode } from '../src/config/demo-mode';
import { readClock } from '../src/core/context';
import { prisma } from '../src/core/db';
import { repairDemoFixtures } from '../src/modules/demo/demo.fixtures';
import { demoReadiness } from '../src/modules/demo/demo.readiness';
import { seedDemo } from '../src/modules/demo/demo.seed';

/** A seed takes well under a minute; one still INITIALIZING after this was interrupted. */
const STALE_MS = 10 * 60_000;

const count = await prisma.member.count();
const readiness = await demoReadiness(prisma);
const stale = readiness.status === 'INITIALIZING' && (!readiness.since || Date.now() - new Date(readiness.since).getTime() > STALE_MS);
if (count === 0) {
  await seedDemo(prisma);
  console.log('Database was empty: demo community seeded.');
} else if (isDemoMode() && (readiness.status === 'FAILED' || stale)) {
  console.log(`Demo preparation did not finish (${readiness.status}${readiness.detail ? `: ${readiness.detail}` : ''}): seeding the demo community again.`);
  await seedDemo(prisma);
} else if (isDemoMode() && readiness.status === 'READY') {
  const { repaired, failed, checks } = await repairDemoFixtures(prisma, await readClock(prisma));
  if (repaired.length) console.log(`Re-created missing demo examples: ${repaired.join(', ')}.`);
  for (const f of failed) console.log(`Could not re-create demo example "${f.key}": ${f.error}`);
  for (const c of checks.filter((x) => x.state !== 'ready')) console.log(`Demo example "${c.key}" is ${c.state}: ${c.detail}`);
  console.log(`Database already has ${count} members: skipping seed.`);
} else {
  console.log(`Database already has ${count} members: skipping seed (demo ${readiness.status.toLowerCase()}).`);
}
await prisma.$disconnect();
