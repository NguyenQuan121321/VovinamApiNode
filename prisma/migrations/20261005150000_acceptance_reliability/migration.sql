-- Stable event identifiers make retries safe after an ambiguous audit commit.
ALTER TABLE "audit_logs" ADD COLUMN "event_id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "audit_logs_event_id_key" ON "audit_logs"("event_id");

-- Recovery must measure the worker lease, not the notification creation time.
ALTER TABLE "notifications" ADD COLUMN "claimed_at" TIMESTAMP(3);
CREATE INDEX "notifications_status_claimed_at_idx" ON "notifications"("status", "claimed_at");
