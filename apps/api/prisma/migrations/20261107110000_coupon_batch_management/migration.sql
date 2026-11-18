ALTER TYPE "CouponStatus" ADD VALUE 'VOID';
ALTER TABLE "CouponTemplate" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TABLE "CouponIssueBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "issuedById" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "targetHash" TEXT NOT NULL,
  "count" INTEGER NOT NULL CHECK ("count" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponIssueBatch_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CouponIssueBatch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CouponTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CouponIssueBatch_issuedById_requestId_key" ON "CouponIssueBatch"("issuedById", "requestId");
ALTER TABLE "MemberCoupon" ADD COLUMN "batchId" TEXT,
  ADD CONSTRAINT "MemberCoupon_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CouponIssueBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "MemberCoupon_batchId_memberId_key" ON "MemberCoupon"("batchId", "memberId");
-- 用文本比较新枚举值，允许本迁移在同一事务执行而不提前使用新枚举常量。
ALTER TABLE "MemberCoupon" DROP CONSTRAINT "MemberCoupon_state";
ALTER TABLE "MemberCoupon" ADD CONSTRAINT "MemberCoupon_state" CHECK (
  ("status"::text IN ('AVAILABLE', 'VOID') AND "orderId" IS NULL AND "reservedAt" IS NULL AND "usedAt" IS NULL) OR
  ("status"::text = 'RESERVED' AND "orderId" IS NOT NULL AND "reservedAt" IS NOT NULL AND "usedAt" IS NULL) OR
  ("status"::text = 'USED' AND "orderId" IS NOT NULL AND "reservedAt" IS NOT NULL AND "usedAt" IS NOT NULL)
);
