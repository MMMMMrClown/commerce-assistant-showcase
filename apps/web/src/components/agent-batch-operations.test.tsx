import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentActionCard, type AgentAction } from './agent-action';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  errorMessage: () => '请求失败',
}));
afterEach(cleanup);
const action: AgentAction = {
  id: 'generic-batch',
  kind: 'BATCH_OPERATIONS',
  status: 'WAITING_CONFIRMATION',
  version: 1,
  payloadHash: 'a'.repeat(64),
  expiresAt: '2099-01-01T00:00:00Z',
  payload: {
    batchOperations: {
      title: '两件商品调价与补货',
      rows: [
        {
          actionId: 'child-price',
          kind: 'PRODUCT_EDIT',
          label: 'PRODUCT_EDIT',
          payload: {
            summary: { name: '合成商品A' },
            fields: [{ label: '售价', before: '99.00', after: '88.00' }],
          },
        },
        {
          actionId: 'child-stock',
          kind: 'PRODUCT_STOCK',
          label: 'PRODUCT_STOCK',
          payload: {
            summary: { name: '合成商品B' },
            fields: [{ label: '现存量', before: 10, after: 20 }],
            input: { reason: '合成补货' },
          },
        },
      ],
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: { data: action } });
});
it('一个确认入口展示不同业务及前后值，部分失败逐项呈现，刷新不提供成功项重发', async () => {
  const partial: AgentAction = {
    ...action,
    status: 'SUCCEEDED',
    version: 3,
    result: {
      succeeded: 1,
      failed: 1,
      pending: 0,
      rows: [
        { actionId: 'child-price', status: 'SUCCEEDED', result: { id: 'p1', status: 'ENABLED' } },
        { actionId: 'child-stock', status: 'FAILED', message: '库存版本已变化' },
      ],
    },
  };
  vi.mocked(api.post).mockResolvedValue({ data: { data: partial } });
  render(<AgentActionCard action={action} />);
  expect(screen.getByText('88.00')).toBeInTheDocument();
  expect(screen.getByText('现存量')).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认执行以上 2 项操作' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/agent/actions/generic-batch/confirm',
      { decision: 'APPROVE', expectedVersion: 1, expectedHash: 'a'.repeat(64) },
      expect.anything(),
    ),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('已完成 1 项，未完成 1 项');
  expect(screen.getByText('库存版本已变化')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /确认执行以上/ })).not.toBeInTheDocument();
});
it('随机创建资料明确标注模拟会员，并显示所有脱敏对象供审核', () => {
  const generated: AgentAction = {
    ...action,
    payload: {
      batchOperations: {
        title: '生成2位模拟会员',
        simulated: true,
        rows: [1, 2].map((i) => ({
          actionId: 'm' + i,
          kind: 'CREATE_MEMBER',
          label: 'MEMBER_CREATE',
          payload: { input: { name: '测试会员（模拟）' + i, maskedPhone: '000****000' + i } },
        })),
      },
    },
  };
  vi.mocked(api.get).mockResolvedValue({ data: { data: generated } });
  render(<AgentActionCard action={generated} />);
  expect(screen.getByText(/生成的是模拟会员资料/)).toBeInTheDocument();
  expect(screen.getByText('手机号：000****0001')).toBeInTheDocument();
  expect(screen.getByText('手机号：000****0002')).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});
