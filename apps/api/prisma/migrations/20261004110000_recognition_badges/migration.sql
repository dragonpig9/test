-- Recognition badges (no economic effect) and the member's display choice.
ALTER TABLE "Member" ADD COLUMN "showBadges" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "MemberBadge" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "MemberBadge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberBadge_memberId_awardedAt_idx" ON "MemberBadge"("memberId", "awardedAt");
CREATE UNIQUE INDEX "MemberBadge_memberId_kind_period_key" ON "MemberBadge"("memberId", "kind", "period");

ALTER TABLE "MemberBadge" ADD CONSTRAINT "MemberBadge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
