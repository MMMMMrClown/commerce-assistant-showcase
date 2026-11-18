'use client';

import { useRef, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, errorMessage } from '@/lib/api';
import { money, type Order } from '@/lib/orders';
import { useAppSelector } from '@/store/store';
import { Button, Dialog, ErrorState, Input, LoadingState } from '../ui';

type Transaction = {
  id: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CLOSED';
  amount: string;
  attempt: number;
  reason?: string;
};
type PaymentDetail = {
  payment: Transaction | null;
  refund: Transaction | null;
  mockEnabled: boolean;
  events: { id: string; kind: string; outcome: string; attempt: number; createdAt: string }[];
};
const labels = { PENDING: '处理中', SUCCEEDED: '成功', FAILED: '失败，可重试', CLOSED: '已关闭' };

export function OrderPayment({
  order,
  onChanged,
}: {
  order: Order;
  onChanged: () => Promise<void>;
}) {
  // 【查询接口】按订单读取支付、退款及处理通知；操作权限使用当前登录员工权限。
  const result = useApi<PaymentDetail>('/orders/' + order.id + '/payment');
  const permissions = useAppSelector((state) => state.auth.user?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const base = '/orders/' + order.id;

  // 【接口调用与防重复】同步锁拦截快速连点；金额只由后端读取，成功后刷新详情及外层列表。
  async function submit(path: string, body: object = {}) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post(base + path, body);
      setConfirming(false);
      await result.reload();
      await onChanged();
      setNotice('处理结果已更新');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (result.loading) return <LoadingState />;
  if (result.error) return <ErrorState message={result.error} retry={result.reload} />;
  if (!result.data) return null;
  const { payment, refund, events, mockEnabled } = result.data;
  const canPay = mockEnabled && permissions.includes('order:pay');
  const canRefund = mockEnabled && permissions.includes('order:refund');
  const expired = !!order.expiresAt && new Date(order.expiresAt).getTime() <= Date.now();

  // 【页面展示】明确本地模拟渠道，区分发起、渠道结果和实际业务完成，不把申请当成成功。
  return (
    <section className="mt-6 space-y-3 rounded-xl border border-line p-4 dark:border-line">
      <h3 className="font-semibold">支付与退款 · 本地模拟</h3>
      <p className="text-sm text-ink-muted">
        不产生真实扣款。发起后请选择渠道结果；失败可重试，成功通知可重放验证防重复。
      </p>
      {!mockEnabled && <p className="text-sm text-ink-muted">当前环境未启用模拟支付。</p>}
      {payment && (
        <p className="break-all text-sm">
          支付：{labels[payment.status]} · {money(payment.amount)} · 第{payment.attempt}次<br />
          <span className="font-mono text-xs">{payment.id}</span>
        </p>
      )}
      {refund && (
        <p className="break-all text-sm">
          退款：{labels[refund.status]} · {money(refund.amount)} · 第{refund.attempt}次<br />
          原因：{refund.reason}
          <br />
          <span className="font-mono text-xs">{refund.id}</span>
        </p>
      )}
      {order.status === 'REFUNDED' && (
        <p className="text-sm text-ink-muted">
          已整单退款；实付保留原交易金额，净收款为0。原券返还但不延长有效期；秒杀名额及限购记录保留。
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-brick">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-tea">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canPay &&
          order.status === 'PENDING_PAYMENT' &&
          !expired &&
          payment?.status !== 'PENDING' &&
          payment?.status !== 'SUCCEEDED' && (
            <Button disabled={busy} onClick={() => void submit('/payment')}>
              {payment ? '重试模拟支付' : '发起模拟支付'}
            </Button>
          )}
        {expired && order.status === 'PENDING_PAYMENT' && (
          <p className="text-sm text-orange-700">已超过支付期限，等待后台关闭；请刷新查看。</p>
        )}
        {canPay &&
          payment?.status === 'PENDING' &&
          order.status === 'PENDING_PAYMENT' &&
          !expired && (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  void submit('/payment/mock-result', {
                    attempt: payment.attempt,
                    outcome: 'SUCCESS',
                  })
                }
              >
                模拟支付成功
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void submit('/payment/mock-result', {
                    attempt: payment.attempt,
                    outcome: 'FAILURE',
                  })
                }
              >
                模拟支付失败
              </Button>
            </>
          )}
        {canPay && payment?.status === 'SUCCEEDED' && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void submit('/payment/mock-result', { attempt: payment.attempt, outcome: 'SUCCESS' })
            }
          >
            重放支付成功通知
          </Button>
        )}
        {canRefund &&
          !order.shippedAt &&
          order.status === 'PAID' &&
          (!refund || refund.status === 'FAILED') && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError('');
                setConfirming(true);
              }}
            >
              {' '}
              {refund ? '重试整单退款' : '申请整单退款'}
            </Button>
          )}
        {canRefund && refund?.status === 'PENDING' && (
          <>
            <Button
              disabled={busy}
              onClick={() =>
                void submit('/refund/mock-result', { attempt: refund.attempt, outcome: 'SUCCESS' })
              }
            >
              模拟退款成功
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void submit('/refund/mock-result', { attempt: refund.attempt, outcome: 'FAILURE' })
              }
            >
              模拟退款失败
            </Button>
          </>
        )}
        {canRefund && refund?.status === 'SUCCEEDED' && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void submit('/refund/mock-result', { attempt: refund.attempt, outcome: 'SUCCESS' })
            }
          >
            重放退款成功通知
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void result.reload();
            void onChanged();
          }}
        >
          刷新支付结果
        </Button>
      </div>
      {/* 【退款确认与校验】明确整单金额、返券及限购规则，确认前不创建退款申请。 */}
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
        title="确认整单退款"
        description={
          '退款金额 ' +
          money(order.paidAmount) +
          '；成功后冲回原积分和累计消费，返券不延有效期，秒杀不返名额。'
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = (refund?.reason ?? reason).trim();
            if (value.length < 2) {
              setError('请填写至少两个字的退款原因');
              return;
            }
            void submit('/refund', { reason: value });
          }}
        >
          <label className="text-sm">
            退款原因
            <Input
              aria-label="退款原因"
              minLength={2}
              maxLength={200}
              required
              disabled={busy || !!refund}
              value={refund?.reason ?? reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="mt-2 text-sm text-brick">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              返回
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '提交中…' : '确认申请'}
            </Button>
          </div>
        </form>
      </Dialog>
      {events.length > 0 && (
        <details className="text-xs text-ink-muted">
          <summary>已处理通知（最近20条）</summary>
          <ul className="mt-2 space-y-1">
            {events.map((event) => (
              <li key={event.id}>
                {event.kind === 'PAYMENT' ? '支付' : '退款'} · 第{event.attempt}次 ·{' '}
                {event.outcome === 'SUCCESS' ? '成功' : '失败'} ·{' '}
                {new Date(event.createdAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
