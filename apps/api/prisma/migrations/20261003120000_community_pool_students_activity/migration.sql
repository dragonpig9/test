-- Student registration, community credit pool, daily job and negative-balance tracking.
-- Existing members keep accountType STANDARD and no student details; they can add them from their profile.
-- Existing negative balances: the daily job reconstructs each open NegativeBalancePeriod from ledger
-- history on its first run (scripts/backfill-negative-balance.ts does the same on demand).

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('STANDARD', 'STUDENT');

-- AlterEnum
ALTER TYPE "LedgerAccountType" ADD VALUE 'SYSTEM_COMMUNITY_POOL';

-- AlterEnum
ALTER TYPE "LedgerTxKind" ADD VALUE 'POOL_DISTRIBUTION';

-- AlterTable
ALTER TABLE "EmailVerification" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'contact';

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "accountType" "AccountType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "studentDeclaredAt" TIMESTAMP(3),
ADD COLUMN     "studentEmail" TEXT,
ADD COLUMN     "studentEmailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "studentEmailVerifiedVia" TEXT,
ADD COLUMN     "university" TEXT;

-- CreateTable
CREATE TABLE "DailyJobRun" (
    "id" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "steps" JSONB,

    CONSTRAINT "DailyJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolDistribution" (
    "id" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "poolBefore" INTEGER NOT NULL,
    "activeUserCount" INTEGER NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "paymentPerRecipient" INTEGER NOT NULL,
    "totalPaid" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "windowStart" TEXT NOT NULL,
    "windowEnd" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolGrant" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "ledgerTransactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegativeBalancePeriod" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "negativeSince" TIMESTAMP(3) NOT NULL,
    "recoveredAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "reminderRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NegativeBalancePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyJobRun_runDate_key" ON "DailyJobRun"("runDate");

-- CreateIndex
CREATE UNIQUE INDEX "PoolDistribution_runDate_key" ON "PoolDistribution"("runDate");

-- CreateIndex
CREATE UNIQUE INDEX "PoolGrant_ledgerTransactionId_key" ON "PoolGrant"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "PoolGrant_memberId_createdAt_idx" ON "PoolGrant"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PoolGrant_distributionId_memberId_key" ON "PoolGrant"("distributionId", "memberId");

-- CreateIndex
CREATE INDEX "NegativeBalancePeriod_memberId_negativeSince_idx" ON "NegativeBalancePeriod"("memberId", "negativeSince");

-- CreateIndex
CREATE UNIQUE INDEX "Member_studentEmail_key" ON "Member"("studentEmail");

-- AddForeignKey
ALTER TABLE "PoolGrant" ADD CONSTRAINT "PoolGrant_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "PoolDistribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolGrant" ADD CONSTRAINT "PoolGrant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegativeBalancePeriod" ADD CONSTRAINT "NegativeBalancePeriod_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one OPEN negative-balance period per member (Prisma cannot express partial unique indexes).
CREATE UNIQUE INDEX "NegativeBalancePeriod_one_open_per_member" ON "NegativeBalancePeriod"("memberId") WHERE "recoveredAt" IS NULL;
