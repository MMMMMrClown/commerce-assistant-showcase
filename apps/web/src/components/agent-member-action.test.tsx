import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentActionCard, type AgentAction } from './agent-action';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn() },
  errorMessage: () => '失败',
}));
const action: AgentAction = {
  id: 'test-member-action',
  kind: 'RENAME_MEMBER',
  status: 'WAITING_CONFIRMATION',
  version: 0,
  payloadHash: 'a'.repeat(64),
  expiresAt: '2099-01-01T00:00:00Z',
  payload: {
    before: { name: '原姓名', maskedPhone: '199****0001' },
    input: { name: '新姓名', memberId: 'm1' },
  },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('新增会员操作卡', () => {
  it('展示姓名前后差异与脱敏手机号，预览不提交', () => {
    render(<AgentActionCard action={action} />);
    expect(screen.getByText('原姓名：原姓名')).toBeInTheDocument();
    expect(screen.getByText('新姓名')).toBeInTheDocument();
    expect(screen.getByText('手机号：199****0001')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('会员操作结果跳转会员管理而非订单', () => {
    render(
      <AgentActionCard
        action={{ ...action, status: 'SUCCEEDED', result: { id: 'm1', status: 'ENABLED' } }}
      />,
    );
    expect(screen.getByRole('link', { name: '前往会员管理查看' })).toHaveAttribute(
      'href',
      '/members',
    );
  });
});
