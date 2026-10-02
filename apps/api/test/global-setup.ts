import { execSync } from 'node:child_process';
import 'dotenv/config';

/** Creates the test database if needed and applies migrations to it. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/\/(\w+)(\?|$)/, '/commonhours_test$2');
  const { PrismaClient } = await import('@prisma/client');
  const admin = new PrismaClient({ datasources: { db: { url: url.replace(/\/commonhours_test/, '/postgres') } } });
  try {
    const exists = await admin.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_database WHERE datname = 'commonhours_test'`);
    if (!exists.length) await admin.$executeRawUnsafe('CREATE DATABASE commonhours_test');
  } catch (e) {
    console.warn('Could not check/create test database (it may already exist):', (e as Error).message);
  } finally {
    await admin.$disconnect();
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
