'use client';

import { Plus, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  StatusTabs,
  useToast,
} from '../components/ui';
import { CreateOrderDialog } from '@/components/orders/create-order-dialog';
import { OrderDetail } from '@/components/orders/order-detail';
import { OrderTable } from '@/components/orders/order-table';
import { useApi } from '../hooks/use-api';
import { api, errorMessage, type PageResult } from '../lib/api';
import { sourceLabels, type Order } from '@/lib/orders';
import { useAppSelector } from '../store/store';

// 订单状态标签页：key 对应后端 status 筛选值，空字符串代表全部订单
const STATUS_TABS = [
  { key: '', label: '全部订单' },
  { key: 'PENDING_PAYMENT', label: '待支付' },
  { key: 'PAID', label: '已支付' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'CANCELED', label: '已取消' },
  { key: 'REFUNDED', label: '已退款' },
] as const;

const FILTER_KEYS = [
  'keyword',
  'memberKeyword',
  'productKeyword',
  'storeKeyword',
  'source',
  'startDate',
  'endDate',
] as const;
export default function OrdersPage() {
  const params = useSearchParams();
  const router = useRouter();
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const pageSize = Math.min(100, Math.max(5, Math.floor(Number(params.get('pageSize')) || 20)));
  const searchString = params.toString();
  const filters = Object.fromEntries(
    FILTER_KEYS.map((k) => [k, params.get(k) || '']).filter(([, value]) => value),
  );
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])),
  );
  useEffect(() => {
    const p = new URLSearchParams(searchString);
    setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, p.get(k) || ''])));
  }, [searchString]);
  const status = params.get('status') || '';
  const incomingOrderId = params.get('orderId');
  const [selectedId, setSelectedId] = useState<string | null>(incomingOrderId);
  useEffect(() => setSelectedId(incomingOrderId), [incomingOrderId]);
  const [creating, setCreating] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState('');
  const [selection, setSelection] = useState({ scope: searchString, ids: new Set<string>() });
  const [batchTargets, setBatchTargets] = useState<Order[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  useEffect(() => {
    setSelection({ scope: searchString, ids: new Set() });
  }, [searchString]);
  const user = useAppSelector((state) => state.auth.user)!;
  const { toast } = useToast();

  const result = useApi<PageResult<Order> & { statusCounts?: Record<string, number> }>(
    '/orders?' +
      new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...filters,
        sortBy: params.get('sortBy') || 'orderedAt',
        sortDirection: params.get('sortDirection') || 'desc',
        ...(status ? { status } : {}),
      }),
  );

  const selectedOrders = (result.data?.items || []).filter(
    (o) => selection.scope === searchString && selection.ids.has(o.id),
  );
  const selectedIds = new Set(selectedOrders.map((o) => o.id));
  const cancelable = selectedOrders.filter(
    (o) => o.source === 'BACKOFFICE' && o.status === 'PENDING_PAYMENT',
  );
  async function cancelBatch() {
    if (batchBusy || !batchTargets.length) return;
    setBatchBusy(true);
    const errors: string[] = [];
    const failed: Order[] = [];
    for (const order of batchTargets) {
      try {
        await api.post('/orders/' + order.id + '/cancel');
      } catch (error) {
        errors.push(`${order.orderNo}：${errorMessage(error)}`);
        failed.push(order);
      }
    }
    const succeeded = batchTargets.length - failed.length;
    setBatchErrors(errors);
    setBatchTargets(failed);
    setSelection({ scope: searchString, ids: new Set(failed.map((o) => o.id)) });
    toast({
      title: `已取消 ${succeeded} 笔订单${failed.length ? `，${failed.length} 笔未成功` : ''}`,
      variant: failed.length ? 'error' : 'success',
    });
    try {
      await result.reload();
    } finally {
      setBatchBusy(false);
    }
  }

  function update(next: Record<string, string | number>) {
    const value = new URLSearchParams(params.toString());
    Object.entries(next).forEach(([key, item]) =>
      String(item) ? value.set(key, String(item)) : value.delete(key),
    );
    router.replace('/orders?' + value.toString());
  }

  async function cancel() {
    if (!cancelTarget || cancelingId) return;
    setCancelingId(cancelTarget);
    setCancelError('');
    try {
      await api.post('/orders/' + cancelTarget + '/cancel');
      setCancelTarget(null);
      toast({ title: '订单已取消', variant: 'success' });
      await result.reload();
    } catch (error) {
      setCancelError(errorMessage(error));
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="订单列表"
        description="管理会员订单，查询历史经营数据"
        action={
          user.permissions.includes('order:create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} />
              会员下单
            </Button>
          ) : undefined
        }
      />
      <StatusTabs
        tabs={STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
        counts={result.data?.statusCounts || null}
        value={status}
        onChange={(key) => update({ status: key, page: 1 })}
      />
      <Card className="p-5">
        <form
          className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            update({ ...draft, page: 1 });
          }}
        >
          <div className="relative">
            <Search size={18} className="absolute left-3 top-2.5 text-ink-faint" />
            <Input
              className="pl-9"
              aria-label="搜索订单号"
              placeholder="订单号"
              value={draft.keyword || ''}
              onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
            />
          </div>
          {[
            ['memberKeyword', '会员姓名或手机号'],
            ['productKeyword', '商品名称或编号'],
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
            aria-label="订单来源"
            value={draft.source || ''}
            onChange={(e) => setDraft({ ...draft, source: e.target.value })}
          >
            <option value="">全部来源</option>
            {Object.entries(sourceLabels).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
          <label className="text-xs text-ink-muted">
            下单开始日期（上海）
            <Input
              type="date"
              aria-label="下单开始日期"
              value={draft.startDate || ''}
              onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            />
          </label>
          <label className="text-xs text-ink-muted">
            下单结束日期（上海）
            <Input
              type="date"
              aria-label="下单结束日期"
              value={draft.endDate || ''}
              onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4">
            <Button type="submit">查询</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSelectedId(null);
                router.replace('/orders');
              }}
            >
              <RotateCcw size={15} />
              重置
            </Button>
            <Select
              aria-label="每页数量"
              value={pageSize}
              onChange={(e) => update({ pageSize: e.target.value, page: 1 })}
            >
              <option value="10">10条/页</option>
              <option value="20">20条/页</option>
              <option value="50">50条/页</option>
            </Select>
          </div>
        </form>
        {result.loading ? (
          <LoadingState />
        ) : result.error ? (
          <ErrorState message={result.error} retry={result.reload} />
        ) : !result.data?.items.length ? (
          <EmptyState />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-sunken p-3 text-sm">
              <span>已选 {selectedOrders.length} 笔（仅当前页）</span>
              {user.permissions.includes('order:cancel') && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!cancelable.length || batchBusy || !!cancelingId}
                  onClick={() => {
                    setBatchErrors([]);
                    setBatchTargets(cancelable);
                  }}
                >
                  取消所选待支付订单{cancelable.length ? `（${cancelable.length}）` : ''}
                </Button>
              )}
              {selectedOrders.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={batchBusy}
                  onClick={() => setSelection({ scope: searchString, ids: new Set() })}
                >
                  清空选择
                </Button>
              )}
              <span className="text-xs text-ink-muted">
                仅待支付的会员订单可批量取消；支付、退款仍逐单处理。
              </span>
            </div>
            <OrderTable
              selection={{
                ids: selectedIds,
                disabled: batchBusy,
                onToggle: (ids, checked) => {
                  const next = new Set(selectedIds);
                  ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
                  setSelection({ scope: searchString, ids: next });
                },
              }}
              sort={{
                by: params.get('sortBy') || 'orderedAt',
                direction: params.get('sortDirection') || 'desc',
              }}
              onSort={(by) =>
                update({
                  sortBy: by,
                  sortDirection:
                    params.get('sortBy') === by && params.get('sortDirection') === 'asc'
                      ? 'desc'
                      : 'asc',
                  page: 1,
                })
              }
              orders={result.data.items}
              canPay={user.permissions.includes('order:pay')}
              canRefund={user.permissions.includes('order:refund')}
              canFulfill={user.permissions.includes('order:fulfill')}
              onView={setSelectedId}
              cancelingId={cancelingId}
              onCancel={
                user.permissions.includes('order:cancel')
                  ? (id) => {
                      setCancelError('');
                      setCancelTarget(id);
                    }
                  : undefined
              }
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={result.data.total}
              onPageChange={(next) => update({ page: next })}
            />
          </>
        )}
      </Card>
      {selectedId && (
        <OrderDetail
          id={selectedId}
          onClose={() => {
            setSelectedId(null);
            if (incomingOrderId) update({ orderId: '' });
          }}
          onChanged={() => void result.reload()}
        />
      )}
      {creating && (
        <CreateOrderDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelectedId(id);
            toast({ title: '已创建待支付订单', variant: 'success' });
            router.replace('/orders?orderId=' + encodeURIComponent(id));
            void result.reload();
          }}
        />
      )}
      <Dialog
        open={batchTargets.length > 0}
        onOpenChange={(open) => {
          if (!open && !batchBusy) {
            setBatchTargets([]);
            setBatchErrors([]);
          }
        }}
        title="批量取消订单"
        description={`确认取消 ${batchTargets.length} 笔待支付订单？成功后释放占用库存及优惠券，取消无法恢复。每笔订单仍由服务端校验权限和状态。`}
      >
        {batchErrors.length > 0 && (
          <div role="alert" className="mb-4 max-h-48 overflow-auto text-sm text-brick">
            {batchErrors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            disabled={batchBusy}
            onClick={() => {
              setBatchTargets([]);
              setBatchErrors([]);
            }}
          >
            返回
          </Button>
          <Button variant="danger" disabled={batchBusy} onClick={cancelBatch}>
            {batchBusy ? '逐笔处理中…' : batchErrors.length ? '重试未成功订单' : '确认取消'}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open && !cancelingId) setCancelTarget(null);
        }}
        title="取消订单"
        description="确认取消这张待支付订单吗？取消后无法恢复。"
      >
        {cancelError && (
          <p role="alert" className="mb-4 text-sm text-brick">
            {cancelError}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" disabled={!!cancelingId} onClick={() => setCancelTarget(null)}>
            返回
          </Button>
          <Button variant="danger" disabled={!!cancelingId} onClick={cancel}>
            {cancelingId ? '处理中…' : '确认取消'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
