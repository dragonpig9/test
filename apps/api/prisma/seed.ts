import { prisma } from '../src/core/db';
import { seedDemo } from '../src/modules/demo/demo.seed';

const started = Date.now();
seedDemo(prisma)
  .then(async (ids) => {
    console.log(`Seeded ${Object.keys(ids).length} demo members in ${Date.now() - started} ms.`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
