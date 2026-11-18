import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
describe('配置与导入结果入口', () => {
  it.each([
    ['BENEFIT_POLICY', '/members'],
    ['MEMBER_TIER', '/members'],
    ['IMPORT_CONFIRM', '/data-imports/history'],
    ['METRIC_STATUS', '/metrics'],
  ])('%s展示差异及正确业务入口', async (kind, href) => {
    const action: AgentAction = {
      id: 'a1',
      kind,
      status: 'SUCCEEDED',
      version: 2,
      payloadHash: 'a'.repeat(64),
      expiresAt: '2099-01-01T00:00:00Z',
      result: { id: 'r1', status: 'SAVED' },
      payload: {
        summary: { name: '合成对象' },
        fields: [{ label: '目标变更', before: '原值', after: '新值' }],
      },
    };
    vi.mocked(api.get).mockResolvedValue({ data: { data: action } });
    render(<AgentActionCard action={action} />);
    expect(screen.getByText('原值', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('新值')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', href));
    expect(api.post).not.toHaveBeenCalled();
  });
});
