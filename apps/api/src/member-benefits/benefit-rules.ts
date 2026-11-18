import { BadRequestException } from '@nestjs/common';
import { MemberTier, Prisma } from '@prisma/client';

export type MemberTierRule = {
  code: MemberTier;
  name: string;
  minimumSpend: string;
  discountBps: number;
  pointsPerYuan: number;
};
export const DEFAULT_MEMBER_TIERS: MemberTierRule[] = [
  {
    code: 'STANDARD',
    name: '普通会员',
    minimumSpend: '0.00',
    discountBps: 10000,
    pointsPerYuan: 1,
  },
  { code: 'SPROUT', name: '优享会员', minimumSpend: '500.00', discountBps: 9800, pointsPerYuan: 1 },
  { code: 'VIP', name: '银卡会员', minimumSpend: '1000.00', discountBps: 9500, pointsPerYuan: 1 },
  { code: 'GOLD', name: '臻享会员', minimumSpend: '1500.00', discountBps: 9200, pointsPerYuan: 2 },
  {
    code: 'PLATINUM',
    name: '典藏会员',
    minimumSpend: '3000.00',
    discountBps: 9000,
    pointsPerYuan: 2,
  },
  {
    code: 'DIAMOND',
    name: '曜享会员',
    minimumSpend: '5000.00',
    discountBps: 8800,
    pointsPerYuan: 3,
  },
];
export type BenefitMember = {
  tierOverride: MemberTier | null;
  totalSpent: Prisma.Decimal;
  points: number;
};
export type BenefitPolicy = { enabled: boolean; tiers: Prisma.JsonValue; version: number };

export function validateTierRules(value: unknown): MemberTierRule[] {
  if (!Array.isArray(value) || value.length !== Object.values(MemberTier).length) {
    throw new BadRequestException('请完整配置六档会员等级');
  }
  const rules = value as MemberTierRule[];
  const codes = new Set<string>();
  const names = new Set<string>();
  let previousSpend = new Prisma.Decimal(-1),
    previousRate = 10000,
    previousPoints = 1;
  rules.forEach((rule, index) => {
    if (
      !rule ||
      !Object.values(MemberTier).includes(rule.code) ||
      codes.has(rule.code) ||
      typeof rule.name !== 'string' ||
      rule.name.trim().length < 2 ||
      rule.name.trim().length > 20 ||
      names.has(rule.name.trim()) ||
      typeof rule.minimumSpend !== 'string' ||
      !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(rule.minimumSpend) ||
      !Number.isInteger(rule.discountBps) ||
      rule.discountBps < 5000 ||
      rule.discountBps > 10000 ||
      !Number.isInteger(rule.pointsPerYuan) ||
      rule.pointsPerYuan < 1 ||
      rule.pointsPerYuan > 10
    ) {
      throw new BadRequestException('等级编码或名称重复、金额格式或权益范围不正确');
    }
    const spend = new Prisma.Decimal(rule.minimumSpend);
    if (
      index === 0 &&
      (rule.code !== MemberTier.STANDARD || !spend.isZero() || rule.discountBps !== 10000)
    ) {
      throw new BadRequestException('首档必须为0元起的基础会员，按原价消费');
    }
    if (
      spend.lte(previousSpend) ||
      rule.discountBps > previousRate ||
      rule.pointsPerYuan < previousPoints
    ) {
      throw new BadRequestException('升级门槛必须递增，高等级折扣和积分权益不能降低');
    }
    codes.add(rule.code);
    names.add(rule.name.trim());
    previousSpend = spend;
    previousRate = rule.discountBps;
    previousPoints = rule.pointsPerYuan;
  });
  return rules.map((rule) => ({
    code: rule.code,
    name: rule.name.trim(),
    minimumSpend: new Prisma.Decimal(rule.minimumSpend).toFixed(2),
    discountBps: rule.discountBps,
    pointsPerYuan: rule.pointsPerYuan,
  }));
}

export function describeBenefits(member: BenefitMember, policy: BenefitPolicy) {
  const tiers = validateTierRules(policy.tiers);
  let automaticIndex = 0;
  tiers.forEach((rule, index) => {
    if (member.totalSpent.gte(rule.minimumSpend)) automaticIndex = index;
  });
  const automatic = tiers[automaticIndex];
  const effective = tiers.find((rule) => rule.code === member.tierOverride) ?? automatic;
  const next = tiers[automaticIndex + 1] ?? null;
  const progress = next
    ? member.totalSpent
        .minus(automatic.minimumSpend)
        .div(new Prisma.Decimal(next.minimumSpend).minus(automatic.minimumSpend))
        .mul(100)
        .toDecimalPlaces(1)
        .toNumber()
    : 100;
  return {
    tier: effective.code,
    tierName: effective.name,
    tierSource: member.tierOverride === null ? 'AUTO' : 'MANUAL',
    automaticTier: automatic.code,
    automaticTierName: automatic.name,
    discountBps: policy.enabled ? effective.discountBps : 10000,
    pointsPerYuan: effective.pointsPerYuan,
    totalSpent: member.totalSpent.toFixed(2),
    points: member.points,
    nextTier: next,
    nextTierAmount: next
      ? new Prisma.Decimal(next.minimumSpend).minus(member.totalSpent).toFixed(2)
      : '0.00',
    growthProgress: Math.min(100, Math.max(0, progress)),
  };
}

export function memberPricing(
  amount: Prisma.Decimal,
  member: BenefitMember,
  policy: BenefitPolicy,
  useBenefit: boolean,
) {
  const benefit = describeBenefits(member, policy);
  const rate = useBenefit ? benefit.discountBps : 10000;
  const progressive = useBenefit && policy.enabled && member.tierOverride === null;
  const segments: {
    tier: MemberTier;
    tierName: string;
    discountBps: number;
    originalAmount: string;
    payableAmount: string;
  }[] = [];
  let payable = amount.mul(rate).div(10000).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  // 【跨档分段计价】成长按实付推进：先付足当前档到下一档的差额，剩余商品金额使用下一档折扣。
  // 全程以Decimal整数分计算，每段四舍五入到分；金额不够跨档时在当前档结束。
  if (progressive) {
    const tiers = validateTierRules(policy.tiers);
    let remaining = amount.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    let growth = member.totalSpent.mul(100);
    let paid = new Prisma.Decimal(0);
    for (let i = 0; i < tiers.length && remaining.gt(0); i++) {
      const rule = tiers[i],
        next = tiers[i + 1];
      if (next && growth.gte(new Prisma.Decimal(next.minimumSpend).mul(100))) continue;
      // 【门槛换算】门槛差额是实付分，不是商品原价分；求四舍五入后能恰好补足差额的最小原价。
      const capacity = next
        ? new Prisma.Decimal(next.minimumSpend)
            .mul(100)
            .minus(growth)
            .minus('0.5')
            .mul(10000)
            .div(rule.discountBps)
            .ceil()
        : remaining;
      const original = Prisma.Decimal.min(remaining, capacity);
      const cost = original
        .mul(rule.discountBps)
        .div(10000)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
      segments.push({
        tier: rule.code,
        tierName: rule.name,
        discountBps: rule.discountBps,
        originalAmount: original.div(100).toFixed(2),
        payableAmount: cost.div(100).toFixed(2),
      });
      remaining = remaining.minus(original);
      growth = growth.plus(cost);
      paid = paid.plus(cost);
    }
    payable = paid.div(100);
  }
  return {
    payableAmount: payable.toFixed(2),
    discountAmount: amount.minus(payable).toFixed(2),
    benefitSnapshot: {
      tier: benefit.tier,
      tierName: benefit.tierName,
      tierSource: benefit.tierSource,
      discountBps: rate,
      policyVersion: policy.version,
      pointsPerYuan: benefit.pointsPerYuan,
      source: payable.lt(amount) ? 'MEMBER' : 'NONE',
      // 【计价快照】保存成长基数及分段明细，创建时成长变化会使旧报价失效；历史订单保持原价。
      pricingMode: progressive ? 'PROGRESSIVE' : 'FIXED',
      ...(progressive ? { growthBase: member.totalSpent.toFixed(2), segments } : {}),
    },
  };
}
