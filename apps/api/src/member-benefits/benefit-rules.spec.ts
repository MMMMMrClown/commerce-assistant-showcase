import { MemberTier, Prisma } from '@prisma/client';
import {
  DEFAULT_MEMBER_TIERS,
  describeBenefits,
  memberPricing,
  validateTierRules,
} from './benefit-rules';

const policy = { enabled: true, tiers: DEFAULT_MEMBER_TIERS, version: 1 };
describe('消费成长等级与定价边界', () => {
  it.each([
    ['0.00', 'STANDARD', 10000, 1],
    ['499.99', 'STANDARD', 10000, 1],
    ['500.00', 'SPROUT', 9800, 1],
    ['999.99', 'SPROUT', 9800, 1],
    ['1000.00', 'VIP', 9500, 1],
    ['1499.99', 'VIP', 9500, 1],
    ['1500.00', 'GOLD', 9200, 2],
    ['2999.99', 'GOLD', 9200, 2],
    ['3000.00', 'PLATINUM', 9000, 2],
    ['4999.99', 'PLATINUM', 9000, 2],
    ['5000.00', 'DIAMOND', 8800, 3],
    ['10000.00', 'DIAMOND', 8800, 3],
  ])('累计%s元对应%s', (spent, code, rate, points) => {
    const result = describeBenefits(
      { totalSpent: new Prisma.Decimal(spent), tierOverride: null, points: 0 },
      policy,
    );
    expect(result.tier).toBe(code);
    expect(result.discountBps).toBe(rate);
    expect(result.pointsPerYuan).toBe(points);
    if (code === 'DIAMOND') expect(result.nextTier).toBeNull();
  });
  it('成长进度以当前档到下一档计算，人工授级不伪造消费成长', () => {
    const regular = describeBenefits(
      { totalSpent: new Prisma.Decimal(1200), tierOverride: null, points: 10 },
      policy,
    );
    expect(regular.nextTierAmount).toBe('300.00');
    expect(regular.growthProgress).toBe(40);
    const manual = describeBenefits(
      { totalSpent: new Prisma.Decimal(0), tierOverride: MemberTier.DIAMOND, points: 0 },
      policy,
    );
    expect(manual.tier).toBe('DIAMOND');
    expect(manual.automaticTier).toBe('STANDARD');
    expect(manual.growthProgress).toBe(0);
    expect(manual.nextTier?.code).toBe('SPROUT');
  });
  it('最高档定价、积分倍率快照与禁用折扣', () => {
    const member = { totalSpent: new Prisma.Decimal(5000), tierOverride: null, points: 0 };
    const quoted = memberPricing(new Prisma.Decimal(82), member, policy, true);
    expect(quoted.payableAmount).toBe('72.16');
    expect(quoted.benefitSnapshot.pointsPerYuan).toBe(3);
    expect(memberPricing(new Prisma.Decimal(82), member, policy, false).payableAmount).toBe(
      '82.00',
    );
    expect(
      memberPricing(new Prisma.Decimal(82), member, { ...policy, enabled: false }, true)
        .payableAmount,
    ).toBe('82.00');
  });
  it('拒绝重复编码、重复名称、倒序门槛与高等级权益降低', () => {
    const invalid = [
      DEFAULT_MEMBER_TIERS.map((rule, i) => ({
        ...rule,
        code: i === 1 ? MemberTier.STANDARD : rule.code,
      })),
      DEFAULT_MEMBER_TIERS.map((rule, i) => ({ ...rule, name: i === 1 ? '普通会员' : rule.name })),
      DEFAULT_MEMBER_TIERS.map((rule, i) => ({
        ...rule,
        minimumSpend: i === 2 ? '400' : rule.minimumSpend,
      })),
      DEFAULT_MEMBER_TIERS.map((rule, i) => ({
        ...rule,
        discountBps: i === 3 ? 9800 : rule.discountBps,
      })),
      DEFAULT_MEMBER_TIERS.map((rule, i) => ({
        ...rule,
        pointsPerYuan: i === 4 ? 1 : rule.pointsPerYuan,
      })),
    ];
    for (const rules of invalid) expect(() => validateTierRules(rules)).toThrow();
  });

  const price = (amount: string, spent = '0', tierOverride: MemberTier | null = null) =>
    memberPricing(
      new Prisma.Decimal(amount),
      { totalSpent: new Prisma.Decimal(spent), tierOverride, points: 0 },
      policy,
      true,
    );

  it('新会员690元跨500门槛，前500原价、后190打9.8折', () => {
    const q = price('690');
    expect(q.payableAmount).toBe('686.20');
    expect(q.discountAmount).toBe('3.80');
    expect(q.benefitSnapshot.source).toBe('MEMBER');
    expect(q.benefitSnapshot.growthBase).toBe('0.00');
    expect(q.benefitSnapshot.segments).toEqual([
      {
        tier: 'STANDARD',
        tierName: '普通会员',
        discountBps: 10000,
        originalAmount: '500.00',
        payableAmount: '500.00',
      },
      {
        tier: 'SPROUT',
        tierName: '优享会员',
        discountBps: 9800,
        originalAmount: '190.00',
        payableAmount: '186.20',
      },
    ]);
  });
  it('已有490元消费时补足10元后升级；恰到门槛没有提前整单打折', () => {
    expect(price('100', '490').payableAmount).toBe('98.20');
    expect(price('500').payableAmount).toBe('500.00');
    expect(price('100', '500').payableAmount).toBe('98.00');
  });
  it('跨多个等级按实付达到门槛，不把优惠掉的金额当作成长', () => {
    const q = price('1200');
    expect(q.payableAmount).toBe('1180.31');
    expect((q.benefitSnapshot.segments ?? []).map((s) => s.payableAmount)).toEqual([
      '500.00',
      '500.00',
      '180.31',
    ]);
    expect(price('1010').payableAmount).toBe('999.80');
    expect(price('1010').benefitSnapshot.segments).toHaveLength(2);
    expect(price('690', '490').payableAmount).toBe('671.31');
  });
  it('人工等级按指定等级整单打折，不参与自动跨档', () => {
    const q = price('690', '0', MemberTier.DIAMOND);
    expect(q.payableAmount).toBe('607.20');
    expect(q.benefitSnapshot.pricingMode).toBe('FIXED');
    expect(q.benefitSnapshot.segments).toBeUndefined();
  });
  it('分角边界与0元金额精确，无负分段、漏算或多算原价', () => {
    expect(price('0').payableAmount).toBe('0.00');
    expect(price('0.02', '499.99').payableAmount).toBe('0.02');
    for (const spent of [
      '0',
      '499.99',
      '500',
      '999.99',
      '1000',
      '1499.99',
      '2999.99',
      '4999.99',
      '5000',
    ]) {
      const q = price('9999.99', spent);
      const parts = q.benefitSnapshot.segments ?? [];
      expect(parts.every((s) => new Prisma.Decimal(s.originalAmount).gt(0))).toBe(true);
      expect(
        parts.reduce((sum, s) => sum.plus(s.originalAmount), new Prisma.Decimal(0)).toFixed(2),
      ).toBe('9999.99');
      expect(
        parts.reduce((sum, s) => sum.plus(s.payableAmount), new Prisma.Decimal(0)).toFixed(2),
      ).toBe(q.payableAmount);
      expect(new Prisma.Decimal(q.payableAmount).lte('9999.99')).toBe(true);
    }
  });
});
