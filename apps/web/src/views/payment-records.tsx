'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/hooks/use-api';
import type { PageResult } from '@/lib/api';
import { money } from '@/lib/orders';
import { paymentStatusLabels, type PaymentRecordRow } from '@/lib/payments';
import {
  PageHeader,
  Card,
  Input,
  Select,
  Button,
  LoadingState,
  ErrorState,
  EmptyState,
  Table,
  Th,
  Td,
  Pagination,
} from '@/components/ui';
import { PaymentRecordDetail } from '@/components/orders/payment-record-detail';
import { MemberAvatar } from '@/components/member-avatar';
import { Badge } from '@/components/ui';
const FILTERS = [
  'keyword',
  'memberKeyword',
  'storeKeyword',
  'status',
  'channel',
  'startDate',
  'endDate',
  'orderId',
] as const;
export default function PaymentRecords({ refunds = false }: { refunds?: boolean }) {
  const params = useSearchParams(),
    router = useRouter(),
    search = params.toString(),
    path = refunds ? '/orders/refunds' : '/orders/payments';
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const incomingId = params.get('recordId');
  const [selected, setSelected] = useState<string | null>(incomingId);
  useEffect(() => setSelected(incomingId), [incomingId]);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(FILTERS.map((k) => [k, params.get(k) || ''])),
  );
  useEffect(() => {
    const p = new URLSearchParams(search);
    setDraft(Object.fromEntries(FILTERS.map((k) => [k, p.get(k) || ''])));
  }, [search]);
  const filters = Object.fromEntries(
    FILTERS.map((k) => [k, params.get(k) || '']).filter(([, v]) => v),
  );
  const result = useApi<PageResult<PaymentRecordRow>>(
    '/payment-records?' +
      new URLSearchParams({
        ...filters,
        kind: refunds ? 'refunds' : 'payments',
        page: String(page),
      }),
  );
  function update(values: Record<string, string | number>) {
    const p = new URLSearchParams(search);
    Object.entries(values).forEach(([k, v]) => (String(v) ? p.set(k, String(v)) : p.delete(k)));
    router.replace(path + '?' + p);
  }
  return (
    <>
      <PageHeader
        title={refunds ? '退款记录' : '支付记录'}
        description="MOCK 本地模拟渠道，不涉及真实资金；处理中不代表成功。日期按记录创建时间（上海）筛选。"
      />
      <Card className="p-5">
        {filters.orderId && (
          <p className="mb-4 text-sm">已限定关联订单；重置可查看权限范围内全部记录。</p>
        )}
        <form
          className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            update({ ...draft, page: 1 });
          }}
        >
          {[
            ['keyword', '订单号或记录编号'],
            ['memberKeyword', '会员姓名或手机号'],
            ['storeKeyword', '门店名称或编号'],
          ].map(([key, label]) => (
            <Input
              key={key}
              aria-label={label}
              placeholder={label}
              value={draft[key] || ''}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          ))}
          <Select
            aria-label="记录状态"
            value={draft.status || ''}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <option value="">全部状态</option>
            {Object.entries(paymentStatusLabels)
              .filter(([key]) => !refunds || key !== 'CLOSED')
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </Select>
          <Select
            aria-label="支付渠道"
            value={draft.channel || ''}
            onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
          >
            <option value="">全部渠道</option>
            <option value="MOCK">MOCK 本地模拟</option>
          </Select>
          <label className="text-xs text-ink-muted">
            记录开始日期（上海）
            <Input
              type="date"
              aria-label="记录开始日期"
              value={draft.startDate || ''}
              onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            />
          </label>
          <label className="text-xs text-ink-muted">
            记录结束日期（上海）
            <Input
              type="date"
              aria-label="记录结束日期"
              value={draft.endDate || ''}
              onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4">
            <Button type="submit">查询</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSelected(null);
                router.replace(path);
              }}
            >
              重置
            </Button>
            <Button type="button" variant="ghost" onClick={() => void result.reload()}>
              刷新
            </Button>
          </div>
        </form>
        {result.loading ? (
          <LoadingState />
        ) : result.error ? (
          <ErrorState message={result.error} retry={result.reload} />
        ) : (
          result.data && (
            <>
              {result.data.items.length ? (
                <Table>
                  <thead>
                    <tr>
                      {[
                        '订单 / 记录号',
                        '会员 / 门店',
                        '渠道 / 关联支付',
                        '金额',
                        '状态',
                        refunds ? '申请人 / 原因' : '发起人',
                        '记录时间',
                        '操作',
                      ].map((t) => (
                        <Th key={t}>{t}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.items.map((r) => (
                      <tr key={r.id}>
                        <Td>
                          {r.order.orderNo}
                          <p className="max-w-56 break-all text-xs text-ink-muted">{r.id}</p>
                        </Td>
                        <Td>
                          {r.order.member ? (
                            <div className="flex min-w-32 items-center gap-2">
                              <MemberAvatar
                                compact
                                name={r.order.member.name}
                                src={r.order.member.avatarUrl}
                              />
                              <div>
                                <p>{r.order.member.name}</p>
                                <p className="text-xs text-ink-muted">{r.order.store.name}</p>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p>未关联会员</p>
                              <p className="text-xs text-ink-muted">{r.order.store.name}</p>
                            </>
                          )}
                        </Td>
                        <Td>
                          {r.channel || r.payment?.channel || '未记录'}
                          {r.paymentId && (
                            <p className="max-w-48 break-all text-xs">{r.paymentId}</p>
                          )}
                        </Td>
                        <Td>{money(r.amount)}</Td>
                        <Td>
                          <div className="min-w-14 whitespace-nowrap">
                            <Badge
                              tone={
                                r.status === 'SUCCEEDED'
                                  ? 'green'
                                  : r.status === 'FAILED'
                                    ? 'red'
                                    : r.status === 'PENDING'
                                      ? 'amber'
                                      : 'neutral'
                              }
                            >
                              {paymentStatusLabels[r.status] || r.status}
                            </Badge>
                          </div>
                          {r.attempt > 1 && (
                            <p className="mt-1 text-xs text-ink-muted">已重试 {r.attempt - 1} 次</p>
                          )}
                        </Td>
                        <Td>
                          <p className="whitespace-nowrap">{r.actorName || r.actorId}</p>
                          <p>{r.reason}</p>
                        </Td>
                        <Td>
                          <p className="text-xs">
                            创建 {new Date(r.createdAt).toLocaleString('zh-CN')}
                          </p>
                          <p className="text-xs text-ink-muted">
                            更新 {new Date(r.updatedAt).toLocaleString('zh-CN')}
                          </p>
                        </Td>
                        <Td>
                          <div className="flex flex-col gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelected(r.id);
                                update({ recordId: r.id });
                              }}
                            >
                              记录详情
                            </Button>
                            <Link
                              className="text-sm underline"
                              href={'/orders?orderId=' + encodeURIComponent(r.order.id)}
                            >
                              关联订单 →
                            </Link>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState />
              )}
              <Pagination
                page={page}
                pageSize={20}
                total={result.data.total}
                onPageChange={(next) => update({ page: next })}
              />
            </>
          )
        )}
      </Card>
      {selected && (
        <PaymentRecordDetail
          key={selected + (refunds ? 'refunds' : 'payments')}
          id={selected}
          refunds={refunds}
          onClose={() => {
            setSelected(null);
            if (incomingId) update({ recordId: '' });
          }}
        />
      )}
    </>
  );
}
