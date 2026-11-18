import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AgentActionCard, type AgentAction } from './agent-action';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  errorMessage: () => '操作失败',
}));
const action: AgentAction = {
  id: 'synthetic-action',
  kind: 'CREATE_ORDER',
  status: 'WAITING_CONFIRMATION',
  version: 3,
  payloadHash: 'a'.repeat(64),
  expiresAt: '2099-01-01T00:00:00+08:00',
  payload: {
    quote: {
      memberName: '合成会员',
      storeName: '合成门店',
      originalAmount: '30.00',
      discountAmount: '0.00',
      payableAmount: '30.00',
      items: [{ productName: '合成商品', quantity: 1, subtotal: '30.00' }],
    },
  },
};
describe('Agent人工确认卡', () => {
  it('等待确认的卡片到期自动失效，不发送批准请求', async () => {
    vi.useFakeTimers();
    try {
      const soon = { ...action, expiresAt: new Date(Date.now() + 1000).toISOString() };
      vi.mocked(api.get).mockResolvedValue({ data: { data: soon } });
      render(<AgentActionCard action={soon} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: '确认执行' })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1001);
      });
      expect(screen.queryByRole('button', { name: '确认执行' })).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('重新提问并生成新的预览');
      expect(api.post).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('刷新后展示持久化拒绝原因，不把失败结果渲染为成功', async () => {
    const failed = {
      ...action,
      status: 'FAILED',
      result: { failure: { message: '库存不足，请重新报价' } },
    };
    vi.mocked(api.get).mockResolvedValue({ data: { data: failed } });
    render(<AgentActionCard action={failed} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('库存不足，请重新报价');
    expect(screen.queryByText('操作已执行')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认执行' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: { data: action } });
    vi.mocked(api.post).mockResolvedValue({
      data: {
        data: {
          ...action,
          status: 'SUCCEEDED',
          version: 5,
          result: { id: 'order1', orderNo: 'TEST-1', status: 'PENDING_PAYMENT' },
        },
      },
    });
  });
  it('展示报价本身不会执行，用户确认只提交版本/hash/决定', async () => {
    render(<AgentActionCard action={action} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(
      '/agent/actions/synthetic-action/confirm',
      { decision: 'APPROVE', expectedVersion: 3, expectedHash: 'a'.repeat(64) },
      { timeout: 60000 },
    );
    await waitFor(() => expect(screen.getByText('操作已执行')).toBeInTheDocument());
  });
  it('模型仍在生成时不能提前点击确认', () => {
    render(<AgentActionCard action={action} disabled />);
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
