ALTER TABLE "Email" ADD COLUMN "lockedAt" TIMESTAMP(3), ADD COLUMN "lockOwner" TEXT, ADD COLUMN "sendAttempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "availableAt" TIMESTAMP(3);

CREATE INDEX "Email_status_lockedAt_idx" ON "Email"("status", "lockedAt");
