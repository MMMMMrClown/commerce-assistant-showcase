import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import MembersView from './members';
import { BenefitPolicyCard } from '@/components/members/benefit-policy';
import { ToastProvider } from '@/components/ui';
const state = vi.hoisted(() => ({
  patch: vi.fn(),
  post: vi.fn(),
  policy: {
    enabled: true,
    version: 7,
    tiers: [
      {
        code: 'STANDARD',
        name: '普通会员',
        minimumSpend: '0',
        discountBps: 10000,
        pointsPerYuan: 1,
      },
      {
        code: 'SPROUT',
        name: '优享会员',
        minimumSpend: '500',
        discountBps: 9800,
        pointsPerYuan: 1,
      },
    ],
  },
}));
vi.mock('@/store/store', () => ({ useAppSelector: () => true }));
vi.mock('@/lib/api', () => ({
  api: {
    patch: state.patch,
    post: state.post,
    get: async () => ({ data: { data: { total: 1 } } }),
  },
  errorMessage: () => '失败',
}));
vi.mock('@/hooks/use-api', () => ({
  useApi: (url: string) => ({
    data:
      url === '/member-benefits/policy'
        ? state.policy
        : {
            items: [
              {
                id: 'm',
                name: '会员甲',
                phone: '19900000001',
                birthday: null,
                enabled: true,
                tier: 'STANDARD',
                tierName: '普通会员',
                tierSource: 'AUTO',
                discountBps: 10000,
                totalSpent: '0',
                points: 0,
              },
            ],
            total: 1,
          },
    loading: false,
    error: '',
    reload: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('列表没有直接停用按钮，编辑状态随资料一起保存', async () => {
  state.patch.mockResolvedValue({});
  render(
    <ToastProvider>
      <MembersView />
    </ToastProvider>,
  );
  expect(screen.queryByRole('button', { name: '停用' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  fireEvent.click(screen.getByRole('radio', { name: '停用' }));
  expect(state.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(state.patch).toHaveBeenCalledWith('/members/m', {
      name: '会员甲',
      phone: '19900000001',
      birthday: null,
      enabled: false,
    }),
  );
});
it('新增会员同时提交生日和状态', async () => {
  state.post.mockResolvedValue({});
  render(
    <ToastProvider>
      <MembersView />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '新增会员' }));
  fireEvent.change(screen.getByLabelText('会员姓名'), { target: { value: '会员乙' } });
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '19900000002' } });
  fireEvent.change(screen.getByLabelText(/生日（可选）/), { target: { value: '2000-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(state.post).toHaveBeenCalledWith('/members', {
      name: '会员乙',
      phone: '19900000002',
      birthday: '2000-01-01',
      enabled: true,
    }),
  );
});
it('行编辑仅展示选中等级，并保留其他档位与版本校验', async () => {
  state.patch.mockResolvedValue({});
  render(
    <ToastProvider>
      <BenefitPolicyCard canManage onChanged={() => {}} />
    </ToastProvider>,
  );
  expect(screen.getByRole('table')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1]);
  expect(screen.queryByLabelText('等级名称0')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('等级名称1'), { target: { value: '优享新名称' } });
  fireEvent.change(screen.getByLabelText('变更原因'), { target: { value: '调整展示名称' } });
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  await waitFor(() => expect(state.patch).toHaveBeenCalled());
  expect(state.patch.mock.calls[0][1]).toEqual({
    enabled: true,
    version: 7,
    reason: '调整展示名称',
    tiers: [state.policy.tiers[0], { ...state.policy.tiers[1], name: '优享新名称' }],
  });
});
