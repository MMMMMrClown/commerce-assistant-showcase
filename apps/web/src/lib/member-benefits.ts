export type MemberTier = 'STANDARD' | 'SPROUT' | 'VIP' | 'GOLD' | 'PLATINUM' | 'DIAMOND';
export type MemberTierRule = {
  code: MemberTier;
  name: string;
  minimumSpend: string;
  discountBps: number;
  pointsPerYuan: number;
};
export type BenefitPolicy = {
  id: string;
  enabled: boolean;
  tiers: MemberTierRule[];
  version: number;
};
export type BenefitMember = {
  avatarUrl?: string | null;
  birthday?: string | null;
  birthdayChangedYear?: number | null;
  id: string;
  name: string;
  phone: string;
  enabled: boolean;
  tierOverride: MemberTier | null;
  tier: MemberTier;
  tierName: string;
  tierSource: 'AUTO' | 'MANUAL';
  totalSpent: string;
  points: number;
  discountBps: number;
  nextTierAmount: string;
  pointsPerYuan: number;
  nextTier: MemberTierRule | null;
  growthProgress: number;
  automaticTier: MemberTier;
  automaticTierName: string;
};
export type BenefitSummary = { member: BenefitMember; policy: BenefitPolicy };
export type BenefitLedger = {
  id: string;
  kind: 'PAYMENT' | 'REFUND';
  amount: string;
  pointsDelta: number;
  ruleVersion: number;
  createdAt: string;
  order: { orderNo: string; store: { name: string } };
};
export type BenefitAudit = {
  id: string;
  reason: string;
  createdAt: string;
  actor: { name: string } | null;
  before: { tierOverride: MemberTier | null };
  after: { tierOverride: MemberTier | null };
};
export const discountText = (bps: number) =>
  bps === 10000 ? '原价' : (bps / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + '折';
export const overrideText = (tier: MemberTier | null, tiers: MemberTierRule[] = []) =>
  tier === null ? '自动等级' : '指定' + (tiers.find((item) => item.code === tier)?.name ?? tier);
