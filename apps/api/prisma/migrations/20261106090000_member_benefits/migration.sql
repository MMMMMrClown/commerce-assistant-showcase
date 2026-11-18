ALTER TYPE "OrderStatus" ADD VALUE 'PAID';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';
CREATE TYPE "MemberTier" AS ENUM ('STANDARD', 'VIP');
CREATE TYPE "BenefitLedgerKind" AS ENUM ('PAYMENT', 'REFUND');
ALTER TABLE "Member" ADD COLUMN "tierOverride" "MemberTier",
  ADD COLUMN "totalSpent" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "benefitSnapshot" JSONB;
CREATE TABLE "MemberBenefitPolicy" (
  "id" TEXT NOT NULL DEFAULT 'default', "enabled" BOOLEAN NOT NULL DEFAULT true,
  "vipThreshold" DECIMAL(12,2) NOT NULL DEFAULT 1000,
  "vipDiscountBps" INTEGER NOT NULL DEFAULT 9500, "pointsPerYuan" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemberBenefitPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemberBenefitPolicy_singleton" CHECK ("id" = 'default'),
  CONSTRAINT "MemberBenefitPolicy_bounds" CHECK ("vipThreshold" > 0 AND "vipDiscountBps" BETWEEN 5000 AND 10000 AND "pointsPerYuan" BETWEEN 1 AND 10)
);
INSERT INTO "MemberBenefitPolicy" ("updatedAt") VALUES (CURRENT_TIMESTAMP);
CREATE TABLE "MemberBenefitAudit" (
  "id" TEXT NOT NULL, "memberId" TEXT, "actorId" TEXT, "action" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "before" JSONB NOT NULL, "after" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberBenefitAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemberBenefitAudit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemberBenefitAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "MemberBenefitAudit_memberId_createdAt_idx" ON "MemberBenefitAudit"("memberId", "createdAt");
CREATE TABLE "MemberBenefitLedger" (
  "id" TEXT NOT NULL, "memberId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "kind" "BenefitLedgerKind" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL, "pointsDelta" INTEGER NOT NULL, "ruleVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberBenefitLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemberBenefitLedger_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MemberBenefitLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MemberBenefitLedger_orderId_kind_key" ON "MemberBenefitLedger"("orderId", "kind");
CREATE INDEX "MemberBenefitLedger_memberId_createdAt_idx" ON "MemberBenefitLedger"("memberId", "createdAt");
ALTER TABLE "Member" ADD CONSTRAINT "Member_benefit_balances_nonnegative" CHECK ("totalSpent" >= 0 AND "points" >= 0);
