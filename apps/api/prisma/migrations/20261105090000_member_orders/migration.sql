-- Additive migration: preserve all existing members, orders and imported records.
ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_PAYMENT';
CREATE TYPE "OrderSource" AS ENUM ('LEGACY', 'CSV_IMPORT', 'BACKOFFICE');
ALTER TABLE "Order"
  ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "memberId" TEXT,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "payableAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "canceledAt" TIMESTAMP(3);
ALTER TABLE "OrderItem" ADD COLUMN "productName" TEXT, ADD COLUMN "productCode" TEXT;
UPDATE "Order" SET "payableAmount" = GREATEST("originalAmount" - "discountAmount", 0);
UPDATE "Order" SET "source" = 'CSV_IMPORT' WHERE "importId" IS NOT NULL;
UPDATE "OrderItem" AS item SET "productName" = product."name", "productCode" = product."code"
  FROM "Product" AS product WHERE item."productId" = product."id";
CREATE INDEX "Order_memberId_orderedAt_idx" ON "Order"("memberId", "orderedAt");
CREATE UNIQUE INDEX "Order_createdById_requestId_key" ON "Order"("createdById", "requestId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
