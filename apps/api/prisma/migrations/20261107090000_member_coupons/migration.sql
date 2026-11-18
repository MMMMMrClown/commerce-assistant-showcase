CREATE TYPE "CouponStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'USED');
ALTER TABLE "Order" ADD COLUMN "couponSnapshot" JSONB;

CREATE TABLE "CouponTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "minimumSpend" DECIMAL(10,2) NOT NULL,
  "discountAmount" DECIMAL(10,2) NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CouponTemplate_bounds" CHECK ("minimumSpend" > 0 AND "discountAmount" > 0 AND "discountAmount" <= "minimumSpend" AND "startsAt" < "endsAt")
);
CREATE TABLE "MemberCoupon" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "issuedById" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" "CouponStatus" NOT NULL DEFAULT 'AVAILABLE',
  "orderId" TEXT,
  "reservedAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberCoupon_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemberCoupon_state" CHECK (
    ("status" = 'AVAILABLE' AND "orderId" IS NULL AND "reservedAt" IS NULL AND "usedAt" IS NULL) OR
    ("status" = 'RESERVED' AND "orderId" IS NOT NULL AND "reservedAt" IS NOT NULL AND "usedAt" IS NULL) OR
    ("status" = 'USED' AND "orderId" IS NOT NULL AND "reservedAt" IS NOT NULL AND "usedAt" IS NOT NULL)
  ),
  CONSTRAINT "MemberCoupon_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MemberCoupon_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CouponTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MemberCoupon_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MemberCoupon_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MemberCoupon_orderId_key" ON "MemberCoupon"("orderId");
CREATE UNIQUE INDEX "MemberCoupon_issuedById_requestId_key" ON "MemberCoupon"("issuedById", "requestId");
CREATE INDEX "MemberCoupon_memberId_status_idx" ON "MemberCoupon"("memberId", "status");
