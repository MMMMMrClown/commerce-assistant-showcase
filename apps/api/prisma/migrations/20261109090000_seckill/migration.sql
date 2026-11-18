ALTER TABLE "Order" ADD COLUMN "seckillSnapshot" JSONB, ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "Order_status_expiresAt_idx" ON "Order"("status", "expiresAt");
CREATE TABLE "SeckillActivity" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "price" DECIMAL(12,2) NOT NULL, "stock" INTEGER NOT NULL, "remainingStock" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "holdMinutes" INTEGER NOT NULL DEFAULT 5, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeckillActivity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SeckillActivity_bounds" CHECK ("stock" BETWEEN 1 AND 100000 AND "remainingStock" BETWEEN 0 AND "stock" AND "price" > 0 AND "startsAt" < "endsAt" AND "holdMinutes" BETWEEN 1 AND 30)
);
CREATE TABLE "SeckillReservation" (
  "id" TEXT PRIMARY KEY, "activityId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED', "releasedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeckillReservation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "SeckillActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SeckillReservation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SeckillReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SeckillReservation_state" CHECK (("status" IN ('RESERVED', 'CONFIRMED') AND "releasedAt" IS NULL) OR ("status" = 'RELEASED' AND "releasedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "SeckillReservation_orderId_key" ON "SeckillReservation"("orderId");
CREATE INDEX "SeckillReservation_activityId_memberId_status_idx" ON "SeckillReservation"("activityId", "memberId", "status");
-- 【数据库限购】跨操作人、跨请求ID也只能持有一个有效活动名额。
CREATE UNIQUE INDEX "SeckillReservation_active_member_key" ON "SeckillReservation"("activityId", "memberId") WHERE "status" IN ('RESERVED', 'CONFIRMED');
