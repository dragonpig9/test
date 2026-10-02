// Seeds the demo community only when the database has no members yet.
// Used by the production start command so a fresh deploy has demo data without wiping later changes.
import { prisma } from '../src/core/db';
import { seedDemo } from '../src/modules/demo/demo.seed';

const count = await prisma.member.count();
if (count === 0) {
  await seedDemo(prisma);
  console.log('Database was empty: demo community seeded.');
} else {
  console.log(`Database already has ${count} members: skipping seed.`);
}
await prisma.$disconnect();
