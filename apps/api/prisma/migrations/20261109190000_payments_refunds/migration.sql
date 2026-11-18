CREATE TABLE "PaymentRecord" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'MOCK', "amount" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "attempt" INTEGER NOT NULL DEFAULT 1,
  "actorId" TEXT NOT NULL, "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentRecord_amount_check" CHECK ("amount" >= 0 AND "attempt" > 0),
  CONSTRAINT "PaymentRecord_status_check" CHECK ("status" IN ('PENDING','SUCCEEDED','FAILED','CLOSED')),
  CONSTRAINT "PaymentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentRecord_orderId_key" ON "PaymentRecord"("orderId");

CREATE TABLE "RefundRecord" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "paymentId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL, "reason" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "attempt" INTEGER NOT NULL DEFAULT 1,
  "refundedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RefundRecord_amount_check" CHECK ("amount" >= 0 AND "attempt" > 0),
  CONSTRAINT "RefundRecord_status_check" CHECK ("status" IN ('PENDING','SUCCEEDED','FAILED')),
  CONSTRAINT "RefundRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RefundRecord_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RefundRecord_orderId_key" ON "RefundRecord"("orderId");
CREATE UNIQUE INDEX "RefundRecord_paymentId_key" ON "RefundRecord"("paymentId");

CREATE TABLE "PaymentEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL, "outcome" TEXT NOT NULL, "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentEvent_kind_check" CHECK ("kind" IN ('PAYMENT','REFUND')),
  CONSTRAINT "PaymentEvent_outcome_check" CHECK ("outcome" IN ('SUCCESS','FAILURE'))
);
CREATE INDEX "PaymentEvent_orderId_createdAt_idx" ON "PaymentEvent"("orderId", "createdAt");
