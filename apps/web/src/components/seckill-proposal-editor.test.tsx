import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentActionCard, type AgentAction } from './agent-action';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  errorMessage: () => '修改失败',
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const card: AgentAction = {
  id: 'proposal1',
  kind: 'CREATE_SECKILL',
  status: 'WAITING_CONFIRMATION',
  version: 0,
  payloadHash: 'a'.repeat(64),
  expiresAt: '2099-01-01T00:00:00Z',
  payload: {
    input: {
      name: '小范围秒杀',
      productId: 'p1',
      price: '39.00',
      stock: 10,
      startsAt: '2099-01-01T01:00:00Z',
      endsAt: '2099-01-01T03:00:00Z',
      holdMinutes: 5,
    },
    summary: { productName: '便携保温杯', regularPrice: '99.00' },
    proposal: {
      rationale: '销量样本较少，建议先做小范围试验。',
      basis: '真实在售商品',
      notice: '名额为建议值，不代表普通商品库存。',
    },
  },
};
describe('秒杀建议草稿编辑', () => {
  it('旧卡延迟返回失效状态不会覆盖修改后的新卡', async () => {
    let resolveOld: (value: { data: { data: AgentAction } }) => void = () => undefined;
    const pending = new Promise<{ data: { data: AgentAction } }>((resolve) => {
      resolveOld = resolve;
    });
    vi.mocked(api.get).mockReturnValue(pending as never);
    const next = {
      ...card,
      id: 'revised',
      payload: { ...card.payload, replacesActionId: card.id },
    };
    vi.mocked(api.post).mockResolvedValue({ data: { data: next } });
    const replaced = vi.fn();
    render(<AgentActionCard action={card} onReplaced={replaced} />);
    fireEvent.click(screen.getByRole('button', { name: '修改方案' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改，重新预览' }));
    await waitFor(() => expect(replaced).toHaveBeenCalledWith(next));
    await act(async () => {
      resolveOld({ data: { data: { ...card, status: 'EXPIRED', version: 1 } } });
      await pending;
    });
    expect(screen.getByRole('button', { name: '确认执行' })).toBeEnabled();
    expect(screen.queryByText('预览已失效')).not.toBeInTheDocument();
  });
  it('展示建议并允许修改，保存只生成新预览，不批准活动', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: card } });
    const next = {
      ...card,
      id: 'proposal2',
      payload: { ...card.payload, input: { ...card.payload.input, price: '29.00' } },
    };
    vi.mocked(api.post).mockResolvedValue({ data: { data: next } });
    const replaced = vi.fn();
    render(<AgentActionCard action={card} onReplaced={replaced} />);
    expect(screen.getByText('建议方案 · 尚未发布')).toBeInTheDocument();
    expect(screen.getByText(/销量样本较少/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '修改方案' }));
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('秒杀价'), { target: { value: '29.00' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改，重新预览' }));
    await waitFor(() => expect(replaced).toHaveBeenCalledWith(next));
    expect(api.post).toHaveBeenCalledExactlyOnceWith(
      '/agent/actions/proposal1/seckill-proposal',
      expect.objectContaining({
        expectedHash: 'a'.repeat(64),
        expectedVersion: 0,
        changes: expect.objectContaining({ price: '29.00' }),
      }),
    );
  });
  it('取消编辑不产生任何写请求', () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: card } });
    render(<AgentActionCard action={card} />);
    fireEvent.click(screen.getByRole('button', { name: '修改方案' }));
    fireEvent.click(screen.getByRole('button', { name: '取消修改' }));
    expect(api.post).not.toHaveBeenCalled();
  });
});
