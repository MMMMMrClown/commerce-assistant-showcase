import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrderFulfillment } from './order-fulfillment';
import type { Order } from '@/lib/orders';
const state = vi.hoisted(() => ({ can: true, post: vi.fn() }));
vi.mock('@/store/store', () => ({
  useAppSelector: (fn: (s: unknown) => unknown) =>
    fn({ auth: { user: { permissions: state.can ? ['order:fulfill'] : [] } } }),
}));
vi.mock('@/lib/api', () => ({ api: { post: state.post }, errorMessage: () => '退款处理中' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.can = true;
});
const order = (extra = {}) =>
  ({ id: 'o1', source: 'BACKOFFICE', status: 'PAID', ...extra }) as Order;
it('发货需明确确认，使用原订单接口并刷新详情', async () => {
  const reload = vi.fn().mockResolvedValue(undefined);
  state.post.mockResolvedValue({});
  render(<OrderFulfillment order={order()} onChanged={reload} />);
  fireEvent.click(screen.getByRole('button', { name: '模拟发货' }));
  expect(state.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认模拟发货' }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(state.post).toHaveBeenCalledWith('/orders/o1/ship');
});
it('已发货进入收货确认，退款处理中和无权限不能操作', () => {
  const view = render(
    <OrderFulfillment order={order({ shippedAt: '2026-11-15T10:00:00Z' })} onChanged={vi.fn()} />,
  );
  expect(screen.getByRole('button', { name: '模拟确认收货' })).toBeInTheDocument();
  view.rerender(
    <OrderFulfillment order={order({ refund: { status: 'PENDING' } })} onChanged={vi.fn()} />,
  );
  expect(screen.queryByRole('button', { name: '模拟发货' })).not.toBeInTheDocument();
  state.can = false;
  view.rerender(<OrderFulfillment order={order()} onChanged={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '模拟发货' })).not.toBeInTheDocument();
});
