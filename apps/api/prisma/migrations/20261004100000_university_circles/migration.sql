-- University circles (one shared room per university), circle messages and topic tags.
ALTER TABLE "Listing" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "CircleRoom" (
    "id" TEXT NOT NULL,
    "universityCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CircleRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CircleMembership" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "leftReason" TEXT,

    CONSTRAINT "CircleMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CircleMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CircleMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CircleRoom_universityCode_key" ON "CircleRoom"("universityCode");
CREATE INDEX "CircleMembership_memberId_idx" ON "CircleMembership"("memberId");
CREATE INDEX "CircleMembership_roomId_leftAt_idx" ON "CircleMembership"("roomId", "leftAt");
CREATE INDEX "CircleMessage_roomId_createdAt_idx" ON "CircleMessage"("roomId", "createdAt");
-- One open circle membership per member (a member belongs to one university circle at a time).
CREATE UNIQUE INDEX "CircleMembership_one_open_per_member" ON "CircleMembership"("memberId") WHERE "leftAt" IS NULL;

ALTER TABLE "CircleMembership" ADD CONSTRAINT "CircleMembership_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CircleRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CircleMembership" ADD CONSTRAINT "CircleMembership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CircleMessage" ADD CONSTRAINT "CircleMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CircleRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CircleMessage" ADD CONSTRAINT "CircleMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
