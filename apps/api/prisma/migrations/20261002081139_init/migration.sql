-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'LEFT');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VouchStatus" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VouchOrigin" AS ENUM ('INVITATION', 'DIRECT');

-- CreateEnum
CREATE TYPE "AmendmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('OFFER', 'REQUEST');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('OPEN', 'WITHDRAWN', 'CLOSED');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('ONLINE', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "ExchangeStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISPUTED', 'SETTLED', 'RELEASED', 'CANCELLED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('MEMBER', 'SYSTEM_EXPIRY', 'SYSTEM_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerTxKind" AS ENUM ('SETTLEMENT', 'EXPIRY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'FROZEN', 'SETTLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('AWAITING_ATTESTATION', 'PANEL_REVIEW', 'NEEDS_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('CONFIRMED', 'REFUTED');

-- CreateEnum
CREATE TYPE "DisputeCondition" AS ENUM ('DELIVERABLE', 'DURATION', 'PUNCTUALITY', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'VOTED', 'RECUSED', 'MISSED', 'NOT_NEEDED');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('CONFIRMED', 'REFUTED', 'UNCLEAR');

-- CreateEnum
CREATE TYPE "PenaltyKind" AS ENUM ('NONPERFORMANCE_FINDING', 'VOUCH_LIABILITY', 'MISCONDUCT_FINDING');

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "skills" TEXT[],
    "location" TEXT NOT NULL DEFAULT '',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "isBootstrap" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "leaveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeName" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL,
    "liabilityPct" INTEGER NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vouch" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "voucheeId" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL,
    "liabilityPct" INTEGER NOT NULL,
    "status" "VouchStatus" NOT NULL,
    "origin" "VouchOrigin" NOT NULL,
    "invitationId" TEXT,
    "termsVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "voucherConsentAt" TIMESTAMP(3) NOT NULL,
    "voucheeConsentAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "lastInteractionAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "Vouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VouchAmendment" (
    "id" TEXT NOT NULL,
    "vouchId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "fromStrength" DOUBLE PRECISION NOT NULL,
    "toStrength" DOUBLE PRECISION NOT NULL,
    "fromLiabilityPct" INTEGER NOT NULL,
    "toLiabilityPct" INTEGER NOT NULL,
    "status" "AmendmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "VouchAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "type" "ListingType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "locationType" "LocationType" NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "availability" TEXT NOT NULL,
    "requiredSkills" TEXT[],
    "status" "ListingStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exchange" (
    "id" TEXT NOT NULL,
    "listingId" TEXT,
    "linkedExchangeId" TEXT,
    "providerId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "proposerId" TEXT NOT NULL,
    "deliverable" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "punctualityRequired" BOOLEAN NOT NULL,
    "creditAmount" INTEGER NOT NULL,
    "giftBonus" INTEGER NOT NULL DEFAULT 0,
    "cancellationNoticeHours" INTEGER NOT NULL,
    "cancellationTerms" TEXT NOT NULL DEFAULT '',
    "confirmationDeadline" TIMESTAMP(3) NOT NULL,
    "status" "ExchangeStatus" NOT NULL,
    "termsVersion" INTEGER NOT NULL DEFAULT 1,
    "providerAcceptedAt" TIMESTAMP(3),
    "recipientAcceptedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "providerConfirmedAt" TIMESTAMP(3),
    "recipientConfirmedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "settledAmount" INTEGER,
    "closedAt" TIMESTAMP(3),
    "cancelRequestedById" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "partialAmount" INTEGER,
    "partialProposedById" TEXT,
    "partialNote" TEXT,
    "liabilitySnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "memberId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "kind" "LedgerTxKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "exchangeId" TEXT,
    "explanation" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "giftBonus" INTEGER NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLot" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,

    CONSTRAINT "CreditLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "condition" "DisputeCondition" NOT NULL,
    "claim" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 1,
    "outcome" "DisputeOutcome",
    "outcomeSource" TEXT,
    "reviewReason" TEXT,
    "nextAction" TEXT,
    "voteDeadline" TIMESTAMP(3),
    "mutualProposalById" TEXT,
    "mutualProposalOutcome" "DisputeOutcome",
    "createdAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttestorSelection" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "stage" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,
    "selectedIds" TEXT[],
    "requiredCount" INTEGER NOT NULL,
    "sufficient" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttestorSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttestorAssignment" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "stage" INTEGER NOT NULL,
    "attestorId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "vote" "VoteChoice",
    "reason" TEXT,
    "votedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttestorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictDeclaration" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "otherMemberId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConflictDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredibilityPenalty" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" "PenaltyKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "disputeId" TEXT,
    "vouchId" TEXT,
    "finding" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredibilityPenalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredibilitySnapshot" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredibilitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "simulatedNow" TIMESTAMP(3),
    "seededAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_handle_key" ON "Member"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Member_email_key" ON "Member"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_code_key" ON "Invitation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_acceptedById_key" ON "Invitation"("acceptedById");

-- CreateIndex
CREATE UNIQUE INDEX "Vouch_invitationId_key" ON "Vouch"("invitationId");

-- CreateIndex
CREATE INDEX "Vouch_voucherId_idx" ON "Vouch"("voucherId");

-- CreateIndex
CREATE INDEX "Vouch_voucheeId_idx" ON "Vouch"("voucheeId");

-- CreateIndex
CREATE INDEX "Listing_status_category_idx" ON "Listing"("status", "category");

-- CreateIndex
CREATE INDEX "Exchange_providerId_idx" ON "Exchange"("providerId");

-- CreateIndex
CREATE INDEX "Exchange_recipientId_idx" ON "Exchange"("recipientId");

-- CreateIndex
CREATE INDEX "Exchange_status_idx" ON "Exchange"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_memberId_key" ON "LedgerAccount"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_exchangeId_key" ON "Reservation"("exchangeId");

-- CreateIndex
CREATE INDEX "Reservation_payerId_status_idx" ON "Reservation"("payerId", "status");

-- CreateIndex
CREATE INDEX "Reservation_payeeId_status_idx" ON "Reservation"("payeeId", "status");

-- CreateIndex
CREATE INDEX "CreditLot_memberId_earnedAt_idx" ON "CreditLot"("memberId", "earnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_exchangeId_key" ON "Dispute"("exchangeId");

-- CreateIndex
CREATE UNIQUE INDEX "AttestorAssignment_disputeId_attestorId_key" ON "AttestorAssignment"("disputeId", "attestorId");

-- CreateIndex
CREATE UNIQUE INDEX "ConflictDeclaration_memberId_otherMemberId_key" ON "ConflictDeclaration"("memberId", "otherMemberId");

-- CreateIndex
CREATE INDEX "CredibilitySnapshot_memberId_createdAt_idx" ON "CredibilitySnapshot"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vouch" ADD CONSTRAINT "Vouch_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vouch" ADD CONSTRAINT "Vouch_voucheeId_fkey" FOREIGN KEY ("voucheeId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vouch" ADD CONSTRAINT "Vouch_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VouchAmendment" ADD CONSTRAINT "VouchAmendment_vouchId_fkey" FOREIGN KEY ("vouchId") REFERENCES "Vouch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VouchAmendment" ADD CONSTRAINT "VouchAmendment_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttestorSelection" ADD CONSTRAINT "AttestorSelection_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttestorAssignment" ADD CONSTRAINT "AttestorAssignment_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttestorAssignment" ADD CONSTRAINT "AttestorAssignment_attestorId_fkey" FOREIGN KEY ("attestorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictDeclaration" ADD CONSTRAINT "ConflictDeclaration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictDeclaration" ADD CONSTRAINT "ConflictDeclaration_otherMemberId_fkey" FOREIGN KEY ("otherMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredibilityPenalty" ADD CONSTRAINT "CredibilityPenalty_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredibilityPenalty" ADD CONSTRAINT "CredibilityPenalty_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredibilityPenalty" ADD CONSTRAINT "CredibilityPenalty_vouchId_fkey" FOREIGN KEY ("vouchId") REFERENCES "Vouch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredibilitySnapshot" ADD CONSTRAINT "CredibilitySnapshot_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
