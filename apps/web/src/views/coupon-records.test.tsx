import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import CouponRecords from './coupon-records';
const state = vi.hoisted(() => ({ requests: [] as string[], replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('templateId=t1'),
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('@/store/store', () => ({ useAppSelector: () => false }));
vi.mock('@/components/members/member-coupons', () => ({
  MemberCoupons: ({ canIssue }: { canIssue: boolean }) => (
    <div>会员券只读：{String(!canIssue)}</div>
  ),
}));
vi.mock('@/hooks/use-api', () => ({
  useApi: (url: string) => {
    state.requests.push(url);
    return {
      data: {
        items: [
          {
            id: 'c1',
            member: { id: 'm', name: '演示会员', phone: '199****0001', enabled: true },
            template: {
              id: 't1',
              name: '演示券',
              version: 1,
              minimumSpend: '100',
              discountAmount: '10',
              startsAt: '2026-11-01T00:00:00Z',
              endsAt: '2026-12-01T00:00:00Z',
            },
            displayStatus: 'AVAILABLE',
            source: 'BIRTHDAY',
            createdAt: '2026-11-14T00:00:00Z',
            issuedBy: { name: '演示运营员' },
          },
        ],
        total: 24,
      },
      loading: false,
      error: '',
      reload: vi.fn(),
    };
  },
}));
afterEach(() => {
  cleanup();
  state.requests = [];
  state.replace.mockClear();
});
it('保留模板筛选，翻页后提交状态搜索回到第一页', async () => {
  render(<CouponRecords />);
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(state.requests.at(-1)).toContain('page=2');
  fireEvent.change(screen.getByLabelText('券状态'), { target: { value: 'EXPIRED' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(state.requests.at(-1)).toContain('status=EXPIRED'));
  const q = new URLSearchParams(state.requests.at(-1)!.split('?')[1]);
  expect(q.get('page')).toBe('1');
  expect(q.get('templateId')).toBe('t1');
});
it('只读角色可核对来源和会员券，重置返回全部记录', () => {
  render(<CouponRecords />);
  expect(screen.getByText('生日关怀')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '会员券' }));
  expect(screen.getByText('会员券只读：true')).toBeInTheDocument();
  cleanup();
  render(<CouponRecords />);
  fireEvent.click(screen.getByRole('button', { name: '重置' }));
  expect(state.replace).toHaveBeenCalledWith('/marketing/coupons/records');
});
