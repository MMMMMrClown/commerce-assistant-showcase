import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BenefitSnapshot } from '@/lib/orders';
import { BenefitPricing } from './benefit-pricing';

afterEach(cleanup);
const snapshot: BenefitSnapshot = {
  tier: 'STANDARD',
  tierName: '普通会员',
  tierSource: 'AUTO',
  discountBps: 10000,
  policyVersion: 1,
  pointsPerYuan: 1,
  source: 'MEMBER',
  pricingMode: 'PROGRESSIVE',
  growthBase: '0.00',
  segments: [
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
  ],
};
describe('会员分段计价明细', () => {
  it('按服务端快照展示原价段与升级折扣段', () => {
    render(<BenefitPricing snapshot={snapshot} />);
    expect(screen.getByText(/普通会员：¥500.00 × 原价 → ¥500.00/)).toBeInTheDocument();
    expect(screen.getByText(/优享会员：¥190.00 × 9.8折 → ¥186.20/)).toBeInTheDocument();
  });
  it('兼容旧订单与人工固定折扣，不展示误导性的分段信息', () => {
    const { container } = render(
      <BenefitPricing snapshot={{ ...snapshot, pricingMode: undefined, segments: undefined }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
