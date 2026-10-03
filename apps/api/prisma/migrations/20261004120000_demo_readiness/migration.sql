-- Demo readiness: INITIALIZING while a reset rebuilds the shared demo community, READY after the fixture checks.
CREATE TYPE "DemoReadiness" AS ENUM ('INITIALIZING', 'READY', 'FAILED');

ALTER TABLE "SystemState"
  ADD COLUMN "demoStatus" "DemoReadiness" NOT NULL DEFAULT 'READY',
  ADD COLUMN "demoStatusDetail" TEXT,
  ADD COLUMN "demoStatusAt" TIMESTAMP(3);
