-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "hall" TEXT,
    "room" TEXT,
    "raUserId" TEXT,
    "expiresAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "payload" JSONB,
    "idempotencyKey" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "raUserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    CONSTRAINT "decisions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT,
    "kind" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" DATETIME,
    "idempotencyKey" TEXT,
    CONSTRAINT "outbox_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_active_case_per_term
ON cases (userId, term)
WHERE state NOT IN ('approved','denied','expired');
