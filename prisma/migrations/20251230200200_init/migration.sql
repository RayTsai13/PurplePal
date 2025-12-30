-- CreateEnum
CREATE TYPE "CaseState" AS ENUM ('joined', 'hall_chosen', 'awaiting_ra', 'approved', 'denied', 'expired');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'ra', 'system');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('approve', 'deny');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('dm', 'channel');

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "state" "CaseState" NOT NULL,
    "hall" TEXT,
    "room" TEXT,
    "raUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromState" "CaseState",
    "toState" "CaseState",
    "payload" JSONB,
    "idempotencyKey" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "raUserId" TEXT NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "kind" "OutboxKind" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cases_userId_term_idx" ON "cases"("userId", "term");

-- CreateIndex
CREATE INDEX "cases_state_idx" ON "cases"("state");

-- CreateIndex
CREATE INDEX "audit_logs_caseId_timestamp_idx" ON "audit_logs"("caseId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_idempotencyKey_idx" ON "audit_logs"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "decisions_caseId_key" ON "decisions"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "decisions_idempotencyKey_key" ON "decisions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_idempotencyKey_key" ON "outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "outbox_status_nextAttemptAt_idx" ON "outbox"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
