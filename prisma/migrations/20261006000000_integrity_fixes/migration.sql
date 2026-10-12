-- AlterEnum
ALTER TYPE "CaseState" ADD VALUE 'cancelled';

-- AlterEnum
ALTER TYPE "OutboxKind" ADD VALUE 'role_add';
ALTER TYPE "OutboxKind" ADD VALUE 'role_remove';

-- Audit logs are immutable: block deleting a case that has audit history instead of cascading
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_caseId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reminder tracking
ALTER TABLE "cases" ADD COLUMN     "remindersSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- Backfill: existing pending cases were submitted at their last update; one reminder at most was sent
UPDATE "cases" SET "submittedAt" = "updatedAt" WHERE "state" = 'awaiting_ra';
UPDATE "cases" SET "remindersSent" = 1 WHERE "reminderSentAt" IS NOT NULL;

-- Expire all but the newest active case per (userId, term) so the unique index below can be built
UPDATE "cases" SET "state" = 'expired', "version" = "version" + 1
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "userId", "term" ORDER BY "createdAt" DESC) AS rn
    FROM "cases"
    WHERE "state" IN ('joined', 'hall_chosen', 'room_number_entered', 'awaiting_ra')
  ) ranked
  WHERE ranked.rn > 1
);

-- At most one active case per user per term (not expressible in schema.prisma)
CREATE UNIQUE INDEX "cases_one_active_per_user_term" ON "cases"("userId", "term")
WHERE "state" IN ('joined', 'hall_chosen', 'room_number_entered', 'awaiting_ra');
