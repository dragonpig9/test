-- Central demo mode: admission route and demo admission, recorded separately from verification.
CREATE TYPE "JoinRoute" AS ENUM ('INVITATION', 'STUDENT');

ALTER TABLE "Member" ADD COLUMN "joinRoute" "JoinRoute" NOT NULL DEFAULT 'INVITATION',
ADD COLUMN "demoAdmittedAt" TIMESTAMP(3),
ADD COLUMN "demoAdmissionReason" TEXT;
