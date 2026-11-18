import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { OrderTable } from './order-table';
import type { Order } from '@/lib/orders';
const fixture: Order = {
  id: 'o1',
  orderNo: 'TEST-01',
  orderedAt: '2026-11-14T00:00:00Z',
  status: 'REFUNDED',
  source: 'BACKOFFICE',
  store: { id: 's', name: '测试门店', region: { name: '测试区' } },
  member: { id: 'm', name: '测试会员', phone: '19900000001' },
  originalAmount: '120',
  discountAmount: '20',
  payableAmount: '100',
  paidAmount: '100',
  benefitSnapshot: null,
  couponSnapshot: null,
  seckillSnapshot: null,
  expiresAt: null,
  refund: { id: 'r', status: 'SUCCEEDED', amount: '100' },
  items: [
    {
      productId: 'p1',
      productName: '合成杯',
      productCode: 'P1',
      quantity: 1,
      unitPrice: '20',
      subtotal: '20',
    },
    {
      productId: 'p2',
      productName: '合成盒',
      productCode: 'P2',
      quantity: 2,
      unitPrice: '50',
      subtotal: '100',
    },
  ],
};
afterEach(cleanup);
it('展示全部商品与独立的原实付/已退款金额', () => {
  render(<OrderTable orders={[fixture]} onView={vi.fn()} />);
  expect(screen.getByText('合成杯')).toBeInTheDocument();
  expect(screen.getByText('合成盒')).toBeInTheDocument();
  const row = within(screen.getAllByRole('row')[1]);
  expect(row.getByText('原实付').parentElement).toHaveTextContent('¥100.00');
  expect(row.getByText('已退款', { selector: 'dt' }).parentElement).toHaveTextContent('¥100.00');
  expect(row.getByText(/共 3 件/)).toBeInTheDocument();
});
it('历史退款没有渠道金额时显示未记录，不能用原实付代替', () => {
  render(
    <OrderTable
      orders={[{ ...fixture, source: 'CSV_IMPORT', refund: null }]}
      onView={vi.fn()}
      canRefund
    />,
  );
  expect(screen.getByText('未记录')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '退款处理' })).not.toBeInTheDocument();
});
it('申请中不计已退款，处理入口按权限和订单状态显示', () => {
  const order = {
    ...fixture,
    status: 'PAID' as const,
    refund: { id: 'r', status: 'PENDING', amount: '100' },
  };
  const view = render(<OrderTable orders={[order]} onView={vi.fn()} />);
  expect(screen.getByText('已退款', { selector: 'dt' }).parentElement).toHaveTextContent('¥0.00');
  expect(screen.queryByRole('button', { name: '退款处理' })).not.toBeInTheDocument();
  view.rerender(<OrderTable orders={[order]} onView={vi.fn()} canRefund />);
  expect(screen.getByRole('button', { name: '退款处理' })).toBeInTheDocument();
});
