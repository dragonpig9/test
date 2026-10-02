import { defineConfig } from 'vitest/config';
import 'dotenv/config';

const testUrl =
  process.env.TEST_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/(\w+)(\?|$)/, '/commonhours_test$2');

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    env: { DATABASE_URL: testUrl, DEMO_MODE: 'true', NODE_ENV: 'test' },
    // Integration tests share one test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
