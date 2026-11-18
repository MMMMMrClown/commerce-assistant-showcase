import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentActionCard, type AgentAction } from './agent-action';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  errorMessage: () => '操作失败',
}));
const action: AgentAction = {
  id: 'batch-action',
  kind: 'BATCH_CREATE_ORDERS',
  status: 'WAITING_CONFIRMATION',
  version: 1,
  payloadHash: 'a'.repeat(64),
  expiresAt: '2099-01-01T00:00:00Z',
  payload: {
    batch: {
      storeName: '合成门店',
      productName: '保温杯',
      benefitMode: 'SECKILL',
      activityName: '杯子秒杀',
      quantityPerMember: 1,
      totalAmount: '40.00',
      rows: [1, 2].map((i) => ({
        member: { id: 'm' + i, name: '合成会员' + i, maskedPhone: '198****000' + i },
        originalAmount: '99.00',
        discountAmount: '79.00',
        payableAmount: '20.00',
      })),
    },
  },
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: { data: action } });
});
it('名单、逐笔报价、总额供一次确认；提交不接受替换会员和金额', async () => {
  const partial: AgentAction = {
    ...action,
    status: 'SUCCEEDED',
    version: 3,
    result: {
      status: 'PARTIAL_FAILED',
      succeeded: 1,
      failed: 1,
      pending: 0,
      rows: [
        { memberId: 'm1', status: 'SUCCEEDED', orderNo: 'TEST-1' },
        { memberId: 'm2', status: 'FAILED', message: '会员已停用' },
      ],
    },
  };
  vi.mocked(api.post).mockResolvedValue({ data: { data: partial } });
  render(<AgentActionCard action={action} />);
  expect(screen.getByText('合成会员1')).toBeInTheDocument();
  expect(screen.getByText(/合计 ¥40.00/)).toBeInTheDocument();
  expect(screen.getByText(/名单已固定/)).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认创建以上 2 笔待支付订单' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/agent/actions/batch-action/confirm',
      {
        decision: 'APPROVE',
        expectedVersion: 1,
        expectedHash: 'a'.repeat(64),
      },
      expect.anything(),
    ),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('已创建 1 笔，未创建 1 笔');
  expect(screen.getByText('会员已停用')).toBeInTheDocument();
  expect(screen.getByText('批次处理完成，存在失败项')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /确认创建以上/ })).not.toBeInTheDocument();
});
it('刷新后保留未知结果和原名单，提供原批次恢复入口', async () => {
  const unknown: AgentAction = {
    ...action,
    status: 'UNKNOWN',
    result: {
      status: 'IN_PROGRESS',
      succeeded: 0,
      failed: 0,
      pending: 2,
      rows: [
        { memberId: 'm1', status: 'UNKNOWN', message: '结果待核对' },
        { memberId: 'm2', status: 'PENDING' },
      ],
    },
  };
  vi.mocked(api.get).mockResolvedValue({ data: { data: unknown } });
  render(<AgentActionCard action={unknown} />);
  expect(await screen.findByRole('button', { name: '核对并恢复同一次操作' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('待核对/处理 2 笔');
  expect(screen.getByText('合成会员2')).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});
