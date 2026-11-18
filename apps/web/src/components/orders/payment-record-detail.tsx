'use client';
import { MemberAvatar } from '@/components/member-avatar';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/use-api';
import type { PageResult } from '@/lib/api';
import { money } from '@/lib/orders';
import { paymentStatusLabels, type PaymentRecordRow, type PaymentEventRow } from '@/lib/payments';
import { Sheet, ErrorState, LoadingState, EmptyState, Pagination, Table, Th, Td } from '../ui';
export function PaymentRecordDetail({
  id,
  refunds,
  onClose,
}: {
  id: string;
  refunds: boolean;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const result = useApi<{ record: PaymentRecordRow; events: PageResult<PaymentEventRow> }>(
    '/payment-records/' +
      encodeURIComponent(id) +
      '?' +
      new URLSearchParams({ kind: refunds ? 'refunds' : 'payments', eventPage: String(page) }),
  );
  const r = result.data?.record;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={refunds ? '退款记录详情' : '支付记录详情'}
      description="MOCK 本地模拟渠道 · 当前记录与已处理通知"
    >
      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState message={result.error} retry={result.reload} />
      ) : (
        r &&
        result.data && (
          <>
            {r.order.member && (
              <div className="mb-4 flex items-center gap-2">
                <MemberAvatar name={r.order.member.name} src={r.order.member.avatarUrl} />
                <span>{r.order.member.name}</span>
              </div>
            )}
            <dl className="mb-5 grid grid-cols-2 gap-4 rounded-xl bg-sunken p-4 text-sm">
              {[
                ['记录编号', r.id],
                ['订单号', r.order.orderNo],
                [
                  '会员 / 门店',
                  (r.order.member?.name || '未关联会员') + ' / ' + r.order.store.name,
                ],
                ['状态', paymentStatusLabels[r.status] || r.status],
                ['渠道', r.channel || r.payment?.channel || '未记录'],
                [refunds ? '退款金额' : '支付金额', money(r.amount)],
                ['当前发起次数', `第 ${r.attempt} 次`],
                [refunds ? '申请人' : '发起人', r.actorName || r.actorId],
                ['创建时间', new Date(r.createdAt).toLocaleString('zh-CN')],
                ['最近更新时间', new Date(r.updatedAt).toLocaleString('zh-CN')],
                ...(r.paidAt ? [['付款成功时间', new Date(r.paidAt).toLocaleString('zh-CN')]] : []),
                ...(r.refundedAt
                  ? [['退款成功时间', new Date(r.refundedAt).toLocaleString('zh-CN')]]
                  : []),
                ...(r.reason ? [['退款原因', r.reason]] : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="mt-1 break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mb-5 flex flex-wrap gap-4 text-sm">
              <Link
                className="underline"
                href={'/orders?orderId=' + encodeURIComponent(r.order.id)}
              >
                前往订单查看或处理 →
              </Link>
              {r.paymentId && (
                <Link
                  className="underline"
                  href={
                    '/orders/payments?orderId=' +
                    encodeURIComponent(r.order.id) +
                    '&recordId=' +
                    encodeURIComponent(r.paymentId)
                  }
                >
                  查看关联支付 →
                </Link>
              )}
              {r.refund && (
                <Link
                  className="underline"
                  href={
                    '/orders/refunds?orderId=' +
                    encodeURIComponent(r.order.id) +
                    '&recordId=' +
                    encodeURIComponent(r.refund.id)
                  }
                >
                  查看关联退款 →
                </Link>
              )}
            </div>
            <p className="mb-4 text-xs leading-relaxed text-ink-muted">
              发起次数用于区分同一笔支付或退款的重试，第1次表示首次发起。通知按对应次数处理，旧通知不会覆盖新一次的结果。
            </p>
            <h3 className="mb-3 font-semibold">已处理通知</h3>
            {result.data.events.items.length ? (
              <Table>
                <thead>
                  <tr>
                    {['通知编号', '对应发起次数', '渠道结果', '金额', '处理时间'].map((v) => (
                      <Th key={v}>{v}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.data.events.items.map((e) => (
                    <tr key={e.id}>
                      <Td>
                        <span className="break-all text-xs">{e.id}</span>
                      </Td>
                      <Td>第 {e.attempt} 次</Td>
                      <Td>
                        {e.outcome === 'SUCCESS'
                          ? '成功'
                          : e.outcome === 'FAILURE'
                            ? '失败'
                            : e.outcome}
                      </Td>
                      <Td>{money(e.amount)}</Td>
                      <Td>{new Date(e.createdAt).toLocaleString('zh-CN')}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState text="暂无已处理通知" />
            )}
            <Pagination
              page={page}
              pageSize={20}
              total={result.data.events.total}
              onPageChange={setPage}
            />
          </>
        )
      )}
    </Sheet>
  );
}
