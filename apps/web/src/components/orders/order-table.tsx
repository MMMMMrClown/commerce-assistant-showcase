'use client';
import { Badge, Button, Table, Td, Th } from '../ui';
import { MemberAvatar } from '../member-avatar';
import { ProductThumbnail } from '../product-thumbnail';
import { money, refundedAmount, sourceLabels, statusLabels, type Order } from '@/lib/orders';
import { retailLabel } from '@/lib/retail-labels';
export function OrderTable({
  orders,
  onView,
  onCancel,
  cancelingId,
  sort,
  onSort,
  canPay = false,
  canRefund = false,
  canFulfill = false,
  selection,
}: {
  orders: Order[];
  onView: (id: string) => void;
  onCancel?: (id: string) => void;
  cancelingId?: string | null;
  sort?: { by: string; direction: string };
  onSort?: (by: string) => void;
  canPay?: boolean;
  canRefund?: boolean;
  canFulfill?: boolean;
  selection?: {
    ids: Set<string>;
    disabled?: boolean;
    onToggle: (ids: string[], checked: boolean) => void;
  };
}) {
  return (
    <Table>
      <thead>
        <tr>
          {selection && (
            <Th>
              <input
                type="checkbox"
                aria-label="选择本页全部订单"
                disabled={selection.disabled}
                checked={orders.length > 0 && orders.every((o) => selection.ids.has(o.id))}
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      orders.some((o) => selection.ids.has(o.id)) &&
                      !orders.every((o) => selection.ids.has(o.id));
                }}
                onChange={(e) =>
                  selection.onToggle(
                    orders.map((o) => o.id),
                    e.target.checked,
                  )
                }
              />
            </Th>
          )}
          <Th
            onSort={onSort ? () => onSort('orderedAt') : undefined}
            direction={sort?.by === 'orderedAt' ? sort.direction : undefined}
          >
            订单信息
          </Th>
          <Th>会员 / 门店</Th>
          <Th>商品明细</Th>
          <Th
            onSort={onSort ? () => onSort('payableAmount') : undefined}
            direction={sort?.by === 'payableAmount' ? sort.direction : undefined}
          >
            订单金额
          </Th>
          <Th
            onSort={onSort ? () => onSort('status') : undefined}
            direction={sort?.by === 'status' ? sort.direction : undefined}
          >
            状态
          </Th>
          <Th>操作</Th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id}>
            {selection && (
              <Td>
                <input
                  type="checkbox"
                  aria-label={`选择订单${order.orderNo}`}
                  disabled={selection.disabled}
                  checked={selection.ids.has(order.id)}
                  onChange={(e) => selection.onToggle([order.id], e.target.checked)}
                />
              </Td>
            )}
            <Td>
              <div className="max-w-56 break-all font-mono text-xs">{order.orderNo}</div>
              <p className="mt-2 text-xs text-ink-muted">
                {new Date(order.orderedAt).toLocaleString('zh-CN')}
              </p>
              <p className="mt-1 text-xs">{sourceLabels[order.source]}</p>
              {order.expiresAt && order.status === 'PENDING_PAYMENT' && (
                <p className="mt-1 text-xs text-ink-muted">
                  支付截止 {new Date(order.expiresAt).toLocaleString('zh-CN')}
                </p>
              )}
            </Td>
            <Td>
              {order.member ? (
                <div className="flex items-center gap-2">
                  <MemberAvatar compact name={order.member.name} src={order.member.avatarUrl} />
                  <div>
                    <p>{order.member.name}</p>
                    <p className="text-xs text-ink-muted">{order.member.phone}</p>
                  </div>
                </div>
              ) : (
                <p className="text-ink-muted">未关联会员</p>
              )}
              <p className="mt-3">{order.store.name}</p>
              <p className="text-xs text-ink-muted">{order.store.region.name}</p>
            </Td>
            <Td>
              <div className="min-w-48 space-y-3">
                {order.items.map((item, index) => (
                  <div
                    key={item.id || item.productId + index}
                    className="flex items-start gap-3 border-b border-line pb-2 last:border-0"
                  >
                    <ProductThumbnail
                      compact
                      name={item.productName ?? item.product?.name ?? '历史商品'}
                      imageUrl={item.product?.imageUrl}
                    />
                    <div>
                      <p className="font-medium">
                        {retailLabel(item.productName ?? item.product?.name ?? '历史商品')}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {item.productCode ?? item.product?.code ?? '—'} · {money(item.unitPrice)} ×{' '}
                        {item.quantity}
                      </p>
                      <p className="text-xs">行原价 {money(item.subtotal)}</p>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-ink-muted">
                  共 {order.items.reduce((n, i) => n + i.quantity, 0)} 件
                </p>
              </div>
            </Td>
            <Td>
              <dl className="min-w-36 space-y-1 text-xs">
                {[
                  ['原价', money(order.originalAmount)],
                  ['优惠', money(order.discountAmount)],
                  ['应付', money(order.payableAmount)],
                  ['原实付', money(order.paidAmount)],
                  [
                    '已退款',
                    refundedAmount(order) === null ? '未记录' : money(refundedAmount(order)!),
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-ink-muted">{k}</dt>
                    <dd className={k === '应付' ? 'font-semibold' : ''}>{v}</dd>
                  </div>
                ))}
              </dl>
            </Td>
            <Td>
              <Badge
                tone={
                  order.status === 'COMPLETED'
                    ? 'green'
                    : order.status === 'PAID'
                      ? 'blue'
                      : order.status === 'PENDING_PAYMENT'
                        ? 'amber'
                        : order.status === 'REFUNDED'
                          ? 'red'
                          : 'neutral'
                }
              >
                {statusLabels[order.status]}
              </Badge>
              {order.status === 'PAID' && (
                <p className="mt-2 text-xs text-ink-muted">
                  {order.shippedAt ? '待收货' : '待发货'}
                </p>
              )}
            </Td>
            <Td>
              <div className="flex min-w-24 flex-col gap-2">
                <Button size="sm" variant="ghost" onClick={() => onView(order.id)}>
                  详情
                </Button>
                {order.source === 'BACKOFFICE' && (
                  <>
                    {canFulfill &&
                      order.status === 'PAID' &&
                      (!order.refund || order.refund.status === 'FAILED') && (
                        <Button size="sm" variant="outline" onClick={() => onView(order.id)}>
                          {order.shippedAt ? '收货处理' : '发货处理'}
                        </Button>
                      )}
                    {canPay &&
                      order.status === 'PENDING_PAYMENT' &&
                      (!order.expiresAt || new Date(order.expiresAt).getTime() > Date.now()) && (
                        <Button size="sm" variant="outline" onClick={() => onView(order.id)}>
                          支付处理
                        </Button>
                      )}
                    {canRefund && !order.shippedAt && order.status === 'PAID' && (
                      <Button size="sm" variant="outline" onClick={() => onView(order.id)}>
                        退款处理
                      </Button>
                    )}
                    {onCancel && order.status === 'PENDING_PAYMENT' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!cancelingId}
                        onClick={() => onCancel(order.id)}
                      >
                        {cancelingId === order.id ? '取消中…' : '取消订单'}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
