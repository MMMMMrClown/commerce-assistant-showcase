import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentActionCard, type AgentAction } from './agent-action';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  errorMessage: () => '操作失败',
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const card = (
  kind: string,
  fields: NonNullable<AgentAction['payload']['fields']>,
): AgentAction => ({
  id: 'edit1',
  kind,
  status: 'WAITING_CONFIRMATION',
  version: 0,
  payloadHash: 'a'.repeat(64),
  expiresAt: '2099-01-01T00:00:00Z',
  payload: { fields, summary: { name: '合成对象' } },
});
describe('新增资料编辑确认卡', () => {
  it('商品差异和影响可见，仅点击后确认，结果入口指向商品管理', async () => {
    const action = card('PRODUCT_EDIT', [{ label: '售价', before: '100', after: '89.90' }]);
    vi.mocked(api.get).mockResolvedValue({ data: { data: action } });
    vi.mocked(api.post).mockResolvedValue({
      data: { data: { ...action, status: 'SUCCEEDED', result: { id: 'p1', status: 'DISABLED' } } },
    });
    render(<AgentActionCard action={action} />);
    expect(screen.getByText('确认修改商品资料')).toBeInTheDocument();
    expect(screen.getByText('89.90')).toBeInTheDocument();
    expect(screen.getByText(/已有订单保留原快照/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/products'));
    expect(api.post).toHaveBeenCalledWith(
      '/agent/actions/edit1/confirm',
      { decision: 'APPROVE', expectedVersion: 0, expectedHash: 'a'.repeat(64) },
      { timeout: 60000 },
    );
  });
  it('会员启停前后状态易读，手机号脱敏，结果入口指向会员管理', async () => {
    const action = {
      ...card('EDIT_MEMBER', [
        { label: '手机号', before: '199****0001', after: '199****0003' },
        { label: '会员启用状态', before: true, after: false },
      ]),
      status: 'SUCCEEDED',
      result: { id: 'm1', status: 'DISABLED' },
    };
    vi.mocked(api.get).mockResolvedValue({ data: { data: action } });
    render(<AgentActionCard action={action} />);
    expect(screen.getByText('启用')).toBeInTheDocument();
    expect(screen.getByText('停用')).toBeInTheDocument();
    expect(screen.getByText('199****0003')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/members'));
    expect(screen.queryByText('19900000003')).not.toBeInTheDocument();
  });
});
