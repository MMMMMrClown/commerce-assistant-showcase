'use client';
import { useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Order } from '@/lib/orders';
import { useAppSelector } from '@/store/store';
import { Button, Card, Dialog } from '../ui';

export function OrderFulfillment({
  order,
  onChanged,
}: {
  order: Order;
  onChanged: () => Promise<void>;
}) {
  const can = useAppSelector((s) => s.auth.user?.permissions.includes('order:fulfill'));
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  if (order.source !== 'BACKOFFICE') return null;
  const step = order.shippedAt ? 'receive' : 'ship';
  const label = step === 'ship' ? '模拟发货' : '模拟确认收货';
  const blocked = order.refund && order.refund.status !== 'FAILED';
  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.post(`/orders/${order.id}/${step}`);
      await onChanged();
      setConfirm(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Card className="my-4 p-4">
      <h3 className="font-semibold">模拟快递履约</h3>
      <p className="my-2 text-xs leading-relaxed text-ink-muted">
        本地演示：模拟发货 → 模拟确认收货 →
        已完成。不接物流公司和轨迹；发货后本版本暂不支持售后退款。
      </p>
      <ol className="my-3 space-y-2 text-sm">
        <li>
          {order.shippedAt
            ? `已发货 · ${new Date(order.shippedAt).toLocaleString('zh-CN')} · ${order.shippedByName || '原操作人'}`
            : order.status === 'COMPLETED'
              ? '历史完成订单，未记录发货过程'
              : '尚未发货'}
        </li>
        <li>
          {order.receivedAt
            ? `已模拟确认收货 · ${new Date(order.receivedAt).toLocaleString('zh-CN')} · ${order.receivedByName || '原操作人'}`
            : order.shippedAt
              ? '待模拟确认收货'
              : '未记录收货'}
        </li>
      </ol>
      {blocked && order.status === 'PAID' && (
        <p className="mb-3 text-sm text-ink-muted">退款正在处理，暂停履约。</p>
      )}
      {can && order.status === 'PAID' && !blocked && (
        <Button
          size="sm"
          onClick={() => {
            setError('');
            setConfirm(true);
          }}
        >
          {label}
        </Button>
      )}
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
        title={label}
        description={
          step === 'ship'
            ? '确认模拟发货？发货后进入待收货，本版本不再允许发货前整单退款。'
            : '这是后台模拟客户收货操作，确认后订单变为已完成并计入完成订单统计。'
        }
      >
        {error && (
          <p role="alert" className="mb-3 text-sm text-brick">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
            返回
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? '处理中…' : '确认' + label}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
