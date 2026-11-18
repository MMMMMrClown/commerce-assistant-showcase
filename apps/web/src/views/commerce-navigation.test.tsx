import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import OrdersPage from './orders';
import PaymentRecords from './payment-records';
import { ToastProvider } from '@/components/ui';
const state = vi.hoisted(() => ({ search: '', replace: vi.fn(), requests: [] as string[] }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('@/store/store', () => ({
  useAppSelector: (select: (s: unknown) => unknown) =>
    select({ auth: { user: { permissions: ['order:view'] } } }),
}));
vi.mock('@/lib/api', () => ({ api: { post: vi.fn() }, errorMessage: () => '失败' }));
vi.mock('@/hooks/use-api', () => ({
  useApi: (url: string) => {
    state.requests.push(url);
    return {
      data: url.startsWith('/orders?')
        ? { items: [], total: 0, statusCounts: { '': 0 } }
        : {
            items: [
              {
                id: 'pay1',
                order: {
                  id: 'o1',
                  orderNo: 'TEST-01',
                  member: { name: '测试会员' },
                  store: { name: '测试门店' },
                },
                amount: '100',
                status: 'SUCCEEDED',
                attempt: 1,
                actorId: 'a',
                actorName: '测试者',
                channel: 'MOCK',
                createdAt: '2026-11-14T00:00:00Z',
                updatedAt: '2026-11-14T00:00:00Z',
              },
            ],
            total: 1,
          },
      loading: false,
      error: '',
      reload: vi.fn(),
    };
  },
}));
vi.mock('@/components/orders/order-detail', () => ({
  OrderDetail: ({ id }: { id: string }) => <div>订单详情 {id}</div>,
}));
vi.mock('@/components/orders/payment-record-detail', () => ({
  PaymentRecordDetail: ({ id, onClose }: { id: string; onClose: () => void }) => (
    <div>
      记录详情 {id}
      <button onClick={onClose}>关闭记录</button>
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  state.search = '';
  state.requests = [];
  state.replace.mockClear();
});
it('订单筛选提交才更新地址，并重置页码、保留选中状态', () => {
  state.search = 'page=4&status=PAID';
  render(
    <ToastProvider>
      <OrdersPage />
    </ToastProvider>,
  );
  fireEvent.change(screen.getByLabelText('会员姓名或手机号'), { target: { value: '会员甲' } });
  expect(state.requests.at(-1)).not.toContain('memberKeyword');
  fireEvent.change(screen.getByLabelText('商品名称或编号'), { target: { value: 'P1' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  const query = new URLSearchParams(state.replace.mock.calls.at(-1)![0].split('?')[1]);
  expect(query.get('page')).toBe('1');
  expect(query.get('memberKeyword')).toBe('会员甲');
  expect(query.get('productKeyword')).toBe('P1');
  expect(query.get('status')).toBe('PAID');
  expect(state.requests.every((p) => p.startsWith('/orders?'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重置' }));
  expect(state.replace).toHaveBeenLastCalledWith('/orders');
});
it('记录深链可打开详情，关闭详情保留关联订单与分页，重置清除筛选', () => {
  state.search = 'orderId=o1&recordId=pay1&page=2';
  render(<PaymentRecords />);
  expect(screen.getByText('记录详情 pay1')).toBeInTheDocument();
  expect(state.requests[0]).toContain('orderId=o1');
  expect(state.requests[0]).not.toContain('recordId');
  fireEvent.click(screen.getByText('关闭记录'));
  const q = new URLSearchParams(state.replace.mock.calls.at(-1)![0].split('?')[1]);
  expect(q.get('orderId')).toBe('o1');
  expect(q.get('page')).toBe('2');
  expect(q.has('recordId')).toBe(false);
  expect(screen.getByRole('link', { name: '关联订单 →' })).toHaveAttribute(
    'href',
    '/orders?orderId=o1',
  );
  fireEvent.click(screen.getByRole('button', { name: '重置' }));
  expect(state.replace).toHaveBeenLastCalledWith('/orders/payments');
});
it('退款记录状态和日期筛选提交到当前子页面并回到第一页', () => {
  state.search = 'page=3';
  render(<PaymentRecords refunds />);
  fireEvent.change(screen.getByLabelText('记录状态'), { target: { value: 'FAILED' } });
  fireEvent.change(screen.getByLabelText('记录开始日期'), { target: { value: '2026-11-14' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  const url = state.replace.mock.calls.at(-1)![0],
    q = new URLSearchParams(url.split('?')[1]);
  expect(url.startsWith('/orders/refunds?')).toBe(true);
  expect(q.get('page')).toBe('1');
  expect(q.get('status')).toBe('FAILED');
  expect(q.get('startDate')).toBe('2026-11-14');
});
