-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExamRegistrationStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'RESULT_PASS', 'RESULT_FAIL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('TUITION', 'EXAM_FEE', 'UNIFORM', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "belt_exams" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "exam_date" DATE NOT NULL,
    "location" VARCHAR(255),
    "target_rank_id" INTEGER NOT NULL,
    "fee_amount" INTEGER NOT NULL,
    "capacity" INTEGER,
    "registration_deadline" DATE NOT NULL,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "belt_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_registrations" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "current_rank_id" INTEGER,
    "target_rank_id" INTEGER NOT NULL,
    "status" "ExamRegistrationStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "result_note" VARCHAR(500),
    "examiner_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoice_no" VARCHAR(20) NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "ref_exam_registration_id" UUID,
    "period_month" INTEGER,
    "period_year" INTEGER,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "due_date" DATE NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" VARCHAR(500),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_amount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "belt_exams_code_key" ON "belt_exams"("code");

-- CreateIndex
CREATE INDEX "belt_exams_exam_date_idx" ON "belt_exams"("exam_date");

-- CreateIndex
CREATE INDEX "exam_registrations_student_id_idx" ON "exam_registrations"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_registrations_exam_id_student_id_key" ON "exam_registrations"("exam_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_no_key" ON "invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "invoices_student_id_idx" ON "invoices"("student_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- AddForeignKey
ALTER TABLE "belt_exams" ADD CONSTRAINT "belt_exams_target_rank_id_fkey" FOREIGN KEY ("target_rank_id") REFERENCES "belt_ranks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "belt_exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_current_rank_id_fkey" FOREIGN KEY ("current_rank_id") REFERENCES "belt_ranks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_target_rank_id_fkey" FOREIGN KEY ("target_rank_id") REFERENCES "belt_ranks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_examiner_id_fkey" FOREIGN KEY ("examiner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_ref_exam_registration_id_fkey" FOREIGN KEY ("ref_exam_registration_id") REFERENCES "exam_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
