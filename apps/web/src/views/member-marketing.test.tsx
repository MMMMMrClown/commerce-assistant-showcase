import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MemberMarketing from './member-marketing';
const state = vi.hoisted(() => ({
  permissions: ['member:view', 'member:benefits-manage', 'member:coupon-issue'],
  requests: [] as string[],
  post: vi.fn(),
  patch: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@/store/store', () => ({
  useAppSelector: (select: (s: unknown) => unknown) =>
    select({ auth: { user: { permissions: state.permissions } } }),
}));
vi.mock('@/lib/api', () => ({
  api: { post: state.post, patch: state.patch },
  errorMessage: () => '配置已变化',
}));
vi.mock('@/hooks/use-api', () => ({
  useApi: (url: string) => {
    state.requests.push(url);
    return {
      data:
        url === '/marketing/programs'
          ? [
              {
                kind: 'WELCOME',
                enabled: true,
                templateId: 't',
                version: 3,
                template: { name: '测试券' },
              },
            ]
          : url === '/coupons/templates'
            ? [{ id: 't', name: '测试券', minimumSpend: '100', discountAmount: '10', version: 1 }]
            : {
                items: [
                  {
                    id: 'g',
                    member: { name: '测试会员' },
                    period: 'ONCE',
                    status: 'FAILED',
                    attempts: 1,
                    templateId: 't',
                    originalTemplateId: 't',
                    createdAt: '2026-11-14T00:00:00Z',
                    lastError: '模板过期',
                  },
                ],
                total: 1,
              },
      loading: false,
      error: '',
      reload: state.reload,
    };
  },
}));
afterEach(() => {
  cleanup();
  state.requests = [];
  state.permissions = ['member:view', 'member:benefits-manage', 'member:coupon-issue'];
  vi.clearAllMocks();
});
it('只读会员角色可以看记录，但不能配置或补发，也不请求管理模板接口', () => {
  state.permissions = ['member:view'];
  render(<MemberMarketing kind="WELCOME" />);
  expect(screen.getByText('测试会员')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '配置玩法' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '按当前配置补发' })).not.toBeInTheDocument();
  expect(state.requests).not.toContain('/coupons/templates');
});
it('失败补发先确认，成功后刷新原记录', async () => {
  state.post.mockResolvedValue({ data: { data: { status: 'SUCCEEDED' } } });
  render(<MemberMarketing kind="WELCOME" />);
  fireEvent.click(screen.getByRole('button', { name: '按当前配置补发' }));
  expect(state.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
  await waitFor(() => expect(state.post).toHaveBeenCalledWith('/marketing/grants/g/retry'));
  expect(await screen.findByRole('status')).toHaveTextContent('已发放');
});
it('保存配置携带当前版本，失败时保留编辑器与错误提示', async () => {
  state.patch.mockRejectedValue(Error());
  render(<MemberMarketing kind="WELCOME" />);
  fireEvent.click(screen.getByRole('button', { name: '配置玩法' }));
  fireEvent.click(screen.getByRole('button', { name: '确认保存配置' }));
  await waitFor(() =>
    expect(state.patch).toHaveBeenCalledWith('/marketing/programs/WELCOME', {
      enabled: true,
      templateId: 't',
      version: 3,
    }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('配置已变化');
});
