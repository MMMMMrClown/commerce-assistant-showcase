import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentActionCard, type AgentAction } from './agent-action';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn() },
  errorMessage: () => '失败',
}));
const base = {
  id: 'fixture',
  status: 'WAITING_CONFIRMATION',
  version: 0,
  payloadHash: 'a'.repeat(64),
  expiresAt: '2099-01-01T00:00:00Z',
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('新增商品和营销确认卡', () => {
  it('发券卡明确展示规则、人数和脱敏对象，预览不会提交', () => {
    const action: AgentAction = {
      ...base,
      kind: 'COUPON_ISSUE',
      payload: {
        summary: {
          templateName: '满300减50',
          minimumSpend: '300',
          discountAmount: '50',
          startsAt: '2099-01-01',
          endsAt: '2099-02-01',
          count: 1,
          recipients: [{ id: 'm1', name: '合成会员', maskedPhone: '199****0001' }],
        },
      },
    };
    render(<AgentActionCard action={action} />);
    expect(screen.getByText('发放对象：1 位会员')).toBeInTheDocument();
    expect(screen.getByText('合成会员 · 199****0001')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('商品创建显示真实冻结字段，结果链接到商品管理', () => {
    render(
      <AgentActionCard
        action={{
          ...base,
          kind: 'PRODUCT_CREATE',
          status: 'SUCCEEDED',
          payload: {
            input: {
              name: '合成商品',
              code: 'TEST',
              categoryId: 'cat',
              price: '129.90',
              costPrice: '50',
            },
          },
          result: { id: 'product1', status: 'ENABLED' },
        }}
      />,
    );
    expect(screen.getByText('售价 ¥129.90 · 成本 ¥50')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往商品管理查看' })).toHaveAttribute(
      'href',
      '/products',
    );
  });
});
