-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'CLASS');

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL,
    "class_id" UUID,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_class_id_idx" ON "announcements"("class_id");

-- CreateIndex
CREATE INDEX "announcements_published_at_idx" ON "announcements"("published_at");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
