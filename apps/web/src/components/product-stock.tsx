'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, errorMessage, type PageResult } from '@/lib/api';
import {
  Button,
  Dialog,
  Input,
  LoadingState,
  ErrorState,
  EmptyState,
  Pagination,
  Table,
  Th,
  Td,
} from './ui';
type Product = {
  id: string;
  name: string;
  stockOnHand?: number | null;
  stockReserved?: number;
  stockVersion?: number;
  stockWarning?: number;
};
type Movement = {
  id: string;
  kind: string;
  beforeOnHand: number | null;
  afterOnHand: number;
  beforeReserved: number;
  afterReserved: number;
  actorId: string;
  reason: string;
  orderId: string | null;
  createdAt: string;
};
const labels: Record<string, string> = {
  INITIALIZE: '初始化',
  ADJUST: '手工调整',
  RESERVE: '下单占用',
  RELEASE: '取消/超时释放',
  CONSUME: '付款扣减',
  REFUND: '退款回补',
};
export function ProductStock({
  product,
  history = false,
  onClose,
  onSaved,
}: {
  product: Product;
  history?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState(String(product.stockOnHand ?? ''));
  const [warning, setWarning] = useState(String(product.stockWarning ?? 0));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [page, setPage] = useState(1);
  async function save() {
    if (busy) return;
    if (
      !/^\d+$/.test(quantity) ||
      !/^\d+$/.test(warning) ||
      !reason.trim() ||
      Number(quantity) < (product.stockReserved || 0)
    ) {
      setError('请填写非负整数、调整原因；现存量不能小于占用量');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/products/' + product.id + '/stock', {
        quantity: Number(quantity),
        warning: Number(warning),
        version: product.stockVersion ?? 0,
        reason,
        requestId,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={(history ? '库存记录 · ' : '库存调整 · ') + product.name}
    >
      {history ? (
        <StockHistory id={product.id} page={page} onPageChange={setPage} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            全平台共享逻辑仓库。现存 {product.stockOnHand ?? '未初始化'} / 占用{' '}
            {product.stockReserved || 0}；调整填写新的现存总量，不是增减差额。旧订单不倒扣库存。
          </p>
          <label className="block">
            现存总量
            <Input
              type="number"
              min={product.stockReserved || 0}
              max={1000000000}
              disabled={busy}
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setRequestId(crypto.randomUUID());
              }}
            />
          </label>
          <label className="block">
            可售库存预警值
            <Input
              type="number"
              min={0}
              max={1000000000}
              disabled={busy}
              value={warning}
              onChange={(e) => {
                setWarning(e.target.value);
                setRequestId(crypto.randomUUID());
              }}
            />
          </label>
          <label className="block">
            调整原因
            <Input
              maxLength={200}
              disabled={busy}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setRequestId(crypto.randomUUID());
              }}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? '保存中…' : '确认保存'}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
function StockHistory({
  id,
  page,
  onPageChange,
}: {
  id: string;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const result = useApi<PageResult<Movement>>('/products/' + id + '/stock-movements?page=' + page);
  if (result.loading) return <LoadingState />;
  if (result.error) return <ErrorState message={result.error} retry={result.reload} />;
  if (!result.data) return null;
  return (
    <>
      {result.data.items.length ? (
        <Table>
          <thead>
            <tr>
              {['类型', '现存变化', '占用变化', '原因 / 单据', '操作人 / 时间'].map((v) => (
                <Th key={v}>{v}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.data.items.map((m) => (
              <tr key={m.id}>
                <Td>{labels[m.kind] || m.kind}</Td>
                <Td>
                  {m.beforeOnHand ?? '未初始化'} → {m.afterOnHand}
                </Td>
                <Td>
                  {m.beforeReserved} → {m.afterReserved}
                </Td>
                <Td>
                  {m.reason}
                  <p className="text-xs">{m.orderId}</p>
                </Td>
                <Td>
                  {m.actorId}
                  <p className="text-xs">{new Date(m.createdAt).toLocaleString('zh-CN')}</p>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState />
      )}
      <Pagination page={page} pageSize={20} total={result.data.total} onPageChange={onPageChange} />
    </>
  );
}
