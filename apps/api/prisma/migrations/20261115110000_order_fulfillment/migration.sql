ALTER TABLE "Order"
  ADD COLUMN "shippedAt" TIMESTAMP(3),
  ADD COLUMN "shippedById" TEXT,
  ADD COLUMN "shippedByName" TEXT,
  ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "receivedById" TEXT,
  ADD COLUMN "receivedByName" TEXT;
