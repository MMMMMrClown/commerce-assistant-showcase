ALTER TYPE "MemberTier" ADD VALUE 'SPROUT';
ALTER TYPE "MemberTier" ADD VALUE 'GOLD';
ALTER TYPE "MemberTier" ADD VALUE 'PLATINUM';
ALTER TYPE "MemberTier" ADD VALUE 'DIAMOND';
-- Keep the previous rule document in the audit trail before changing the policy shape.
INSERT INTO "MemberBenefitAudit" ("id", "action", "reason", "before", "after")
  SELECT 'migration-growth-member-tiers-20261106', 'POLICY',
    '会员体系升级：原两级规则归档，启用六档累计消费等级；历史订单和人工等级保留',
    to_jsonb(policy), jsonb_build_object('tiers', '[{"code":"STANDARD","name":"晴芽会员","minimumSpend":"0.00","discountBps":10000,"pointsPerYuan":1},{"code":"SPROUT","name":"初啡会员","minimumSpend":"500.00","discountBps":9800,"pointsPerYuan":1},{"code":"VIP","name":"醇香会员","minimumSpend":"1000.00","discountBps":9500,"pointsPerYuan":1},{"code":"GOLD","name":"臻享会员","minimumSpend":"1500.00","discountBps":9200,"pointsPerYuan":2},{"code":"PLATINUM","name":"典藏会员","minimumSpend":"3000.00","discountBps":9000,"pointsPerYuan":2},{"code":"DIAMOND","name":"曜享会员","minimumSpend":"5000.00","discountBps":8800,"pointsPerYuan":3}]'::jsonb)
  FROM "MemberBenefitPolicy" policy WHERE "id" = 'default';
ALTER TABLE "MemberBenefitPolicy" ADD COLUMN "tiers" JSONB NOT NULL DEFAULT '[{"code":"STANDARD","name":"晴芽会员","minimumSpend":"0.00","discountBps":10000,"pointsPerYuan":1},{"code":"SPROUT","name":"初啡会员","minimumSpend":"500.00","discountBps":9800,"pointsPerYuan":1},{"code":"VIP","name":"醇香会员","minimumSpend":"1000.00","discountBps":9500,"pointsPerYuan":1},{"code":"GOLD","name":"臻享会员","minimumSpend":"1500.00","discountBps":9200,"pointsPerYuan":2},{"code":"PLATINUM","name":"典藏会员","minimumSpend":"3000.00","discountBps":9000,"pointsPerYuan":2},{"code":"DIAMOND","name":"曜享会员","minimumSpend":"5000.00","discountBps":8800,"pointsPerYuan":3}]'::jsonb;
ALTER TABLE "MemberBenefitPolicy" ALTER COLUMN "tiers" DROP DEFAULT;
ALTER TABLE "MemberBenefitPolicy" DROP CONSTRAINT "MemberBenefitPolicy_bounds",
  DROP COLUMN "vipThreshold", DROP COLUMN "vipDiscountBps", DROP COLUMN "pointsPerYuan";
UPDATE "MemberBenefitPolicy" SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP;
