'use client';

import Link from 'next/link';
import { retailLabel } from '@/lib/retail-labels';
import { useApi } from '@/hooks/use-api';
import { money, refundedAmount, sourceLabels, statusLabels, type Order } from '@/lib/orders';
import { ErrorState, LoadingState, Sheet, Table, Td, Th } from '../ui';
import { OrderPayment } from './order-payment';
import { OrderFulfillment } from './order-fulfillment';
import { MemberAvatar } from '../member-avatar';
import { BenefitPricing } from './benefit-pricing';

export function OrderDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const result = useApi<Order>('/orders/' + id);
  const order = result.data;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="订单详情"
      description="成交金额与权益按下单快照；旧演示名称统一为零售展示名称，原始快照保留"
    >
      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState message={result.error} retry={result.reload} />
      ) : (
        order && (
          <>
            <p className="mb-4 break-all font-mono text-sm">{order.orderNo}</p>
            {order.member && (
              <div className="mb-4 flex items-center gap-2">
                <MemberAvatar name={order.member.name} src={order.member.avatarUrl} />
                <span>
                  {order.member.name} · {order.member.phone}
                </span>
              </div>
            )}
            <dl className="mb-6 grid grid-cols-2 gap-4 rounded-xl bg-sunken p-4 text-sm dark:bg-sunken">
              {[
                [
                  '会员',
                  order.member ? order.member.name + ' · ' + order.member.phone : '未关联会员',
                ],
                ['门店', order.store.name],
                ['状态', statusLabels[order.status]],
                ...(order.expiresAt
                  ? [['支付截止时间', new Date(order.expiresAt).toLocaleString('zh-CN')]]
                  : []),
                ['来源', sourceLabels[order.source]],
                ...(order.seckillSnapshot
                  ? [
                      ['秒杀活动', retailLabel(order.seckillSnapshot.name)],
                      ['活动价', money(order.seckillSnapshot.price)],
                    ]
                  : []),
                ...(order.couponSnapshot
                  ? [
                      ['满减券', order.couponSnapshot.name],
                      [
                        '用券规则',
                        '满' +
                          order.couponSnapshot.minimumSpend +
                          '减' +
                          order.couponSnapshot.discountAmount,
                      ],
                      [
                        '用券说明',
                        order.status === 'CANCELED'
                          ? '订单已取消，已释放占用'
                          : order.status === 'PENDING_PAYMENT'
                            ? '待支付占用，尚未核销'
                            : '按下单时券规则成交',
                      ],
                    ]
                  : []),
                ...(order.benefitSnapshot
                  ? [
                      ['下单时会员等级', retailLabel(order.benefitSnapshot.tierName)],
                      [
                        '会员优惠',
                        order.benefitSnapshot.source === 'MEMBER'
                          ? order.benefitSnapshot.pricingMode === 'PROGRESSIVE'
                            ? '按下单时分段规则成交'
                            : '按原会员权益成交'
                          : '未使用会员折扣',
                      ],
                    ]
                  : []),
                ['原价', money(order.originalAmount)],
                ['优惠', money(order.discountAmount)],
                ['应付', money(order.payableAmount)],
                ['原实付', money(order.paidAmount)],
                [
                  '已退款',
                  refundedAmount(order) === null ? '未记录' : money(refundedAmount(order)!),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="mt-1 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {order.source === 'BACKOFFICE' && (
              <div className="mb-4 flex gap-4 text-sm">
                <Link href={'/orders/payments?orderId=' + encodeURIComponent(order.id)}>
                  查看支付记录 →
                </Link>
                <Link href={'/orders/refunds?orderId=' + encodeURIComponent(order.id)}>
                  查看退款记录 →
                </Link>
              </div>
            )}
            <OrderFulfillment
              order={order}
              onChanged={async () => {
                await result.reload();
                onChanged?.();
              }}
            />
            <BenefitPricing snapshot={order.benefitSnapshot} />
            <Table>
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th>单价</Th>
                  <Th>数量</Th>
                  <Th>小计</Th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id ?? item.productId}>
                    <Td>{retailLabel(item.productName ?? item.product?.name ?? '历史商品')}</Td>
                    <Td>{money(item.unitPrice)}</Td>
                    <Td>{item.quantity}</Td>
                    <Td>{money(item.subtotal)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {/* 【支付结果回调】详情与外层订单列表同时刷新，会员关联订单使用同一入口。 */}
            {order.source === 'BACKOFFICE' && (
              <OrderPayment
                order={order}
                onChanged={async () => {
                  await result.reload();
                  onChanged?.();
                }}
              />
            )}
          </>
        )
      )}
    </Sheet>
  );
}
