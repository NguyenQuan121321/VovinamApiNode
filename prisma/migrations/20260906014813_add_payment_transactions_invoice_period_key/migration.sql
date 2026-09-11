-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('PAYOS', 'SEPAY', 'CASH', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentTxnStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'DISPUTED');

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "order_ref" VARCHAR(20) NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "gateway_txn_id" VARCHAR(64),
    "amount" INTEGER NOT NULL,
    "status" "PaymentTxnStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "recorded_by" UUID,
    "note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_order_ref_key" ON "payment_transactions"("order_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_gateway_txn_id_key" ON "payment_transactions"("gateway_txn_id");

-- CreateIndex
CREATE INDEX "payment_transactions_invoice_id_idx" ON "payment_transactions"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_student_id_type_period_month_period_year_key" ON "invoices"("student_id", "type", "period_month", "period_year");

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

