-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'ZNS', 'SMS', 'INAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('DATA_PROCESSING', 'MEDIA_USAGE', 'MARKETING_NOTICE');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "template_code" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "error" VARCHAR(500),
    "read_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "consented_by_user_id" UUID,
    "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "consent_logs_user_id_purpose_idx" ON "consent_logs"("user_id", "purpose");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_consented_by_user_id_fkey" FOREIGN KEY ("consented_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
