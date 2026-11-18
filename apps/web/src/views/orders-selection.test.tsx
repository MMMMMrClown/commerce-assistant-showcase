import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OrdersPage from './orders';
import { ToastProvider } from '@/components/ui';

const state = vi.hoisted(() => ({
  search: '',
  permissions: ['order:view', 'order:cancel'],
  post: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/store/store', () => ({
  useAppSelector: (fn: (s: unknown) => unknown) =>
    fn({ auth: { user: { permissions: state.permissions } } }),
}));
vi.mock('@/lib/api', () => ({ api: { post: state.post }, errorMessage: () => '订单状态已变化' }));
vi.mock('@/components/orders/order-detail', () => ({ OrderDetail: () => null }));
vi.mock('@/components/orders/create-order-dialog', () => ({ CreateOrderDialog: () => null }));
vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    loading: false,
    error: '',
    reload: state.reload,
    data: {
      total: 4,
      items: [
        ['1', 'PENDING_PAYMENT', 'BACKOFFICE'],
        ['2', 'PENDING_PAYMENT', 'BACKOFFICE'],
        ['3', 'PAID', 'BACKOFFICE'],
        ['4', 'PENDING_PAYMENT', 'LEGACY'],
      ].map(([id, status, source]) => ({
        id,
        orderNo: 'ORDER-' + id,
        status,
        source,
        orderedAt: '2026-11-15T00:00:00Z',
        store: { name: '静安店', region: { name: '华东' } },
        items: [],
        originalAmount: '100',
        payableAmount: '100',
        discountAmount: '0',
        paidAmount: '0',
      })),
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.search = '';
  state.permissions = ['order:view', 'order:cancel'];
});
const page = () => (
  <ToastProvider>
    <OrdersPage />
  </ToastProvider>
);

it('全选只批量取消可取消订单，失败订单保留并可明确重试', async () => {
  state.post.mockResolvedValueOnce({}).mockRejectedValueOnce(Error('changed'));
  render(page());
  fireEvent.click(screen.getByLabelText('选择本页全部订单'));
  expect(screen.getByText('已选 4 笔（仅当前页）')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '取消所选待支付订单（2）' }));
  expect(state.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认取消' }));
  await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(1));
  expect(state.post.mock.calls.map((c) => c[0])).toEqual(['/orders/1/cancel', '/orders/2/cancel']);
  expect(screen.getByText('ORDER-2：订单状态已变化')).toBeInTheDocument();
  expect(screen.getByLabelText('选择订单ORDER-2')).toBeChecked();
  expect(screen.getByLabelText('选择订单ORDER-1')).not.toBeChecked();
});
it('换页后不沿用上一页勾选，表头支持部分选中状态', () => {
  const view = render(page());
  fireEvent.click(screen.getByLabelText('选择订单ORDER-1'));
  expect((screen.getByLabelText('选择本页全部订单') as HTMLInputElement).indeterminate).toBe(true);
  state.search = 'page=2';
  view.rerender(page());
  expect(screen.getByText('已选 0 笔（仅当前页）')).toBeInTheDocument();
});
it('无取消权限仍可勾选查看，但不显示批量取消操作', () => {
  state.permissions = ['order:view'];
  render(page());
  fireEvent.click(screen.getByLabelText('选择本页全部订单'));
  expect(screen.queryByRole('button', { name: /取消所选/ })).not.toBeInTheDocument();
  expect(state.post).not.toHaveBeenCalled();
});
