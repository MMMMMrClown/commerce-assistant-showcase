import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@/lib/orders';
import { OrderPayment } from './order-payment';

const mock = vi.hoisted(() => ({
  post: vi.fn(),
  reload: vi.fn(),
  permissions: ['order:pay', 'order:refund'],
  detail: { payment: null, refund: null, mockEnabled: true, events: [] } as Record<string, unknown>,
}));
vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({ data: mock.detail, loading: false, error: '', reload: mock.reload }),
}));
vi.mock('@/store/store', () => ({ useAppSelector: () => mock.permissions }));
vi.mock('@/lib/api', () => ({ api: { post: mock.post }, errorMessage: () => '网络错误' }));
const order = (status = 'PENDING_PAYMENT') =>
  ({ id: 'o1', status, paidAmount: '20.00', expiresAt: null }) as Order;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mock.permissions = ['order:pay', 'order:refund'];
  mock.detail = { payment: null, refund: null, mockEnabled: true, events: [] };
  mock.post.mockResolvedValue({});
  mock.reload.mockResolvedValue(undefined);
});
describe('支付退款页面操作', () => {
  it('快速连点仅发起一次支付，完成后刷新详情及列表', async () => {
    let finish!: () => void;
    mock.post.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const changed = vi.fn().mockResolvedValue(undefined);
    render(<OrderPayment order={order()} onChanged={changed} />);
    const button = screen.getByRole('button', { name: '发起模拟支付' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mock.post).toHaveBeenCalledTimes(1);
    expect(mock.post).toHaveBeenCalledWith('/orders/o1/payment', {});
    finish();
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(mock.reload).toHaveBeenCalledOnce();
  });
  it('通知携带当前尝试号，不提交金额', async () => {
    mock.detail.payment = { id: 'p1', status: 'PENDING', amount: '20.00', attempt: 2 };
    render(<OrderPayment order={order()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '模拟支付成功' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith('/orders/o1/payment/mock-result', {
        outcome: 'SUCCESS',
        attempt: 2,
      }),
    );
  });
  it('退款先展示确认和金额，取消不请求；确认后才创建申请', async () => {
    render(<OrderPayment order={order('PAID')} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '申请整单退款' }));
    expect(screen.getByText(/退款金额 ¥20.00/)).toBeInTheDocument();
    expect(mock.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^返回$/ }));
    expect(mock.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '申请整单退款' }));
    fireEvent.change(screen.getByLabelText('退款原因'), { target: { value: '顾客申请' } });
    fireEvent.click(screen.getByRole('button', { name: '确认申请' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith('/orders/o1/refund', { reason: '顾客申请' }),
    );
  });
  it('缺少支付退款权限时不显示操作按钮', () => {
    mock.permissions = [];
    render(<OrderPayment order={order()} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '发起模拟支付' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '申请整单退款' })).not.toBeInTheDocument();
  });
  it('接口失败保留页面和重试入口，不显示处理成功', async () => {
    mock.post.mockRejectedValueOnce(new Error('offline'));
    render(<OrderPayment order={order()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '发起模拟支付' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络错误');
    expect(screen.getByRole('button', { name: '发起模拟支付' })).toBeEnabled();
    expect(mock.reload).not.toHaveBeenCalled();
  });
});
