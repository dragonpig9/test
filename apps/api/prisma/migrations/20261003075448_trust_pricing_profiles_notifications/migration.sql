-- CreateEnum
CREATE TYPE "TrustTier" AS ENUM ('STANDARD', 'RESTRICTED', 'HIGH_TRUST');

-- CreateEnum
CREATE TYPE "SkillTier" AS ENUM ('STANDARD', 'SKILLED', 'ADVANCED', 'SPECIALIST');

-- CreateEnum
CREATE TYPE "SkillClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'PREVIEW', 'SKIPPED');

-- AlterTable
ALTER TABLE "AttestorSelection" ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'random-v1';

-- AlterTable
ALTER TABLE "Exchange" ADD COLUMN     "baseCredits" INTEGER,
ADD COLUMN     "demandMultiplierPct" INTEGER,
ADD COLUMN     "eligibilitySnapshot" JSONB,
ADD COLUMN     "homeAccessApprovedAt" TIMESTAMP(3),
ADD COLUMN     "homeAccessApprovedVersion" INTEGER,
ADD COLUMN     "maxCreditBudget" INTEGER,
ADD COLUMN     "minCredibility" INTEGER,
ADD COLUMN     "minRelationshipTrust" DOUBLE PRECISION,
ADD COLUMN     "priceLockedAt" TIMESTAMP(3),
ADD COLUMN     "priceSnapshot" JSONB,
ADD COLUMN     "pricingQuote" JSONB,
ADD COLUMN     "skillMultiplierPct" INTEGER,
ADD COLUMN     "skillTier" "SkillTier",
ADD COLUMN     "trustTier" "TrustTier" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "maxCreditBudget" INTEGER,
ADD COLUMN     "minCredibility" INTEGER,
ADD COLUMN     "minRelationshipTrust" DOUBLE PRECISION,
ADD COLUMN     "trustTier" "TrustTier" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "affiliation" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "availability" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactEmailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "contactEmailVerifiedVia" TEXT,
ADD COLUMN     "emailCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "homeAddress" TEXT,
ADD COLUMN     "juryAvailable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "profileUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "shareContactWithPartners" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EarnedRelationship" (
    "id" TEXT NOT NULL,
    "memberAId" TEXT NOT NULL,
    "memberBId" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL,
    "countedExchanges" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lastExchangeAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarnedRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustUpdate" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "previousStrength" DOUBLE PRECISION NOT NULL,
    "newStrength" DOUBLE PRECISION NOT NULL,
    "applied" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "relationshipTrustBefore" DOUBLE PRECISION,
    "relationshipTrustAfter" DOUBLE PRECISION,
    "ruleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillClaim" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tier" "SkillTier" NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" "SkillClaimStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "SkillClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillReview" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "approve" BOOLEAN NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT,
    "memberId" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EarnedRelationship_memberAId_memberBId_key" ON "EarnedRelationship"("memberAId", "memberBId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustUpdate_exchangeId_key" ON "TrustUpdate"("exchangeId");

-- CreateIndex
CREATE INDEX "TrustUpdate_relationshipId_createdAt_idx" ON "TrustUpdate"("relationshipId", "createdAt");

-- CreateIndex
CREATE INDEX "SkillClaim_memberId_category_idx" ON "SkillClaim"("memberId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SkillReview_claimId_reviewerId_key" ON "SkillReview"("claimId", "reviewerId");

-- CreateIndex
CREATE INDEX "EmailVerification_memberId_createdAt_idx" ON "EmailVerification"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_memberId_createdAt_idx" ON "Notification"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_notificationId_key" ON "EmailOutbox"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_dedupeKey_key" ON "EmailOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_memberId_createdAt_idx" ON "EmailOutbox"("memberId", "createdAt");

-- AddForeignKey
ALTER TABLE "EarnedRelationship" ADD CONSTRAINT "EarnedRelationship_memberAId_fkey" FOREIGN KEY ("memberAId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnedRelationship" ADD CONSTRAINT "EarnedRelationship_memberBId_fkey" FOREIGN KEY ("memberBId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustUpdate" ADD CONSTRAINT "TrustUpdate_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "EarnedRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustUpdate" ADD CONSTRAINT "TrustUpdate_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillClaim" ADD CONSTRAINT "SkillClaim_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillReview" ADD CONSTRAINT "SkillReview_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "SkillClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillReview" ADD CONSTRAINT "SkillReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

