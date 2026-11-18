import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateOrderDialog } from './create-order-dialog';
import { CouponIssuer, MemberCoupons } from '../members/member-coupons';
import { ToastProvider } from '../ui';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  api: { post: mocks.post, patch: mocks.patch, delete: mocks.remove },
  errorMessage: () => '网络错误',
}));
vi.mock('@/hooks/use-api', () => ({
  useApi: (url: string) => {
    const template = {
      id: 't1',
      version: 1,
      name: '满30减5',
      minimumSpend: '30',
      discountAmount: '5',
      startsAt: '2020-01-01T00:00:00Z',
      endsAt: '2099-01-01T00:00:00Z',
    };
    let data: unknown = [];
    if (url.startsWith('/stores'))
      data = { items: [{ id: 's1', name: '测试门店', enabled: true }] };
    if (url.startsWith('/members?'))
      data = {
        items: [
          { id: 'm1', name: '甲会员', phone: '111', enabled: true },
          { id: 'm2', name: '乙会员', phone: '222', enabled: true },
        ],
      };
    if (url.startsWith('/products'))
      data = {
        items: [{ id: 'p1', name: '测试咖啡', enabled: true, category: { enabled: true } }],
      };
    if (url === '/coupons/templates') data = [template];
    if (url === '/coupons/members/m1')
      data = [{ id: 'c1', status: 'AVAILABLE', displayStatus: 'AVAILABLE', template }];
    return { data, loading: false, error: '', reload: mocks.reload };
  },
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});
function fillOrder() {
  fireEvent.change(screen.getByLabelText('门店'), { target: { value: 's1' } });
  fireEvent.change(screen.getByLabelText('会员'), { target: { value: 'm1' } });
  fireEvent.change(screen.getByLabelText('商品1'), { target: { value: 'p1' } });
  fireEvent.change(screen.getByLabelText('数量1'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('会员优惠'), { target: { value: 'COUPON' } });
  fireEvent.change(screen.getByLabelText('会员满减券'), { target: { value: 'c1' } });
}

describe('满减券用户操作', () => {
  it('秒杀入口固定活动和一件商品，不显示其他优惠或数量修改入口', async () => {
    mocks.post.mockResolvedValue({
      data: {
        data: {
          quoteHash: 'q',
          memberName: '甲会员',
          storeName: '测试门店',
          payableAmount: '9.90',
          discountAmount: '30.10',
          originalAmount: '40.00',
          items: [],
          couponSnapshot: null,
          seckillSnapshot: { name: '限量咖啡' },
          benefitSnapshot: { source: 'NONE' },
        },
      },
    });
    render(
      <CreateOrderDialog
        seckillActivity={{
          id: 'a1',
          name: '限量咖啡',
          productId: 'p1',
          price: '9.90',
          stock: 3,
          remainingStock: 3,
          startsAt: '2020-01-01T00:00:00Z',
          endsAt: '2099-01-01T00:00:00Z',
          holdMinutes: 5,
          enabled: true,
          product: { name: '测试咖啡', price: '20', enabled: true },
        }}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('会员优惠')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('数量1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('门店'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('会员'), { target: { value: 'm1' } });
    fireEvent.click(screen.getByRole('button', { name: '计算金额' }));
    await screen.findByRole('button', { name: '确认创建订单' });
    expect(mocks.post).toHaveBeenCalledWith(
      '/orders/quote',
      expect.objectContaining({
        activityId: 'a1',
        benefitMode: 'SECKILL',
        items: [{ productId: 'p1', quantity: 1 }],
      }),
    );
  });
  it('预览只请求报价并显示券后金额，确认创建才提交选中的券', async () => {
    const created = vi.fn();
    mocks.post.mockImplementation(async (url: string) => ({
      data: {
        data:
          url === '/orders'
            ? { id: 'o1' }
            : {
                quoteHash: 'hash',
                memberName: '甲会员',
                storeName: '测试门店',
                payableAmount: '35.00',
                originalAmount: '40.00',
                discountAmount: '5.00',
                couponSnapshot: { name: '满30减5' },
                benefitSnapshot: { source: 'NONE' },
                items: [
                  { productId: 'p1', productName: '测试咖啡', quantity: 2, subtotal: '40.00' },
                ],
              },
      },
    }));
    render(<CreateOrderDialog onClose={vi.fn()} onCreated={created} />);
    fillOrder();
    fireEvent.click(screen.getByRole('button', { name: '计算金额' }));
    expect(await screen.findByText('¥35.00')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith(
      '/orders/quote',
      expect.objectContaining({ benefitMode: 'COUPON', couponId: 'c1' }),
    );
    expect(screen.getByText(/确认创建订单才占用券/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认创建订单' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith('o1'));
    expect(mocks.post).toHaveBeenLastCalledWith(
      '/orders',
      expect.objectContaining({ couponId: 'c1', quoteHash: 'hash', requestId: expect.any(String) }),
    );
  });

  it('切换会员后不会保留上一位会员的券，也不能带空券请求报价', () => {
    render(<CreateOrderDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    fillOrder();
    fireEvent.change(screen.getByLabelText('会员'), { target: { value: 'm2' } });
    expect(screen.getByLabelText('会员满减券')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '计算金额' }));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('用券时需选择优惠券');
  });

  it('发券网络失败后重试沿用原标识，成功后刷新券列表', async () => {
    mocks.post
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { data: { id: 'c2' } } });
    render(
      <ToastProvider>
        <MemberCoupons
          member={{ id: 'm1', name: '甲会员', enabled: true }}
          canIssue
          onClose={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole('link', { name: /管理优惠券模板/ })).toHaveAttribute(
      'href',
      '/marketing/coupons',
    );
    fireEvent.change(screen.getByLabelText('发券模板'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认发券' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '确认发券' }));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(mocks.post.mock.calls[0][1]).toEqual(mocks.post.mock.calls[1][1]);
    expect(screen.getByLabelText('发券模板')).toHaveValue('');
  });

  it('没有发券权限仍可看会员券，隐藏发券操作', () => {
    render(
      <MemberCoupons
        member={{ id: 'm1', name: '甲会员', enabled: true }}
        canIssue={false}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: '确认发券' })).not.toBeInTheDocument();
    expect(screen.getByText('可用')).toBeInTheDocument();
  });

  // 【模板管理回归】模板编辑和停发在营销管理入口验证，保留版本与二次确认检查。
  it('模板管理入口编辑时提交原版本，保存新版本后刷新列表', async () => {
    mocks.patch.mockResolvedValue({ data: { data: { id: 't2' } } });
    const updated = vi.fn();
    render(
      <ToastProvider>
        <CouponIssuer templatesOnly onIssued={updated} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByLabelText('券名称')).toHaveValue('满30减5');
    fireEvent.change(screen.getByLabelText('券名称'), { target: { value: '满30减8' } });
    fireEvent.change(screen.getByLabelText('减免金额（元）'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        '/coupons/templates/t1',
        expect.objectContaining({ name: '满30减8', discountAmount: '8', version: 1 }),
      ),
    );
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(updated).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('模板管理入口停发需要确认，取消时不发送请求', async () => {
    mocks.remove.mockResolvedValue({});
    render(
      <ToastProvider>
        <CouponIssuer templatesOnly onIssued={vi.fn()} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '停止发放' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '确认停止发放' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '停止发放' }));
    fireEvent.click(screen.getByRole('button', { name: '确认停止发放' }));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('/coupons/templates/t1'),
    );
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });

  // 【会员卡券回归】导航和单张券作废仍从会员弹窗验证，不与模板停发混为一次操作。
  it('会员弹窗保留模板管理入口，不再展示旧的模板编辑按钮', () => {
    render(
      <ToastProvider>
        <MemberCoupons
          member={{ id: 'm1', name: '甲会员', enabled: true }}
          canIssue
          onClose={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole('link', { name: '管理优惠券模板 →' })).toHaveAttribute(
      'href',
      '/marketing/coupons',
    );
    expect(screen.queryByRole('button', { name: '修改所选模板' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除所选模板' })).not.toBeInTheDocument();
  });

  it('会员单张券作废需要独立确认，不调用模板停发接口', async () => {
    mocks.remove.mockResolvedValue({});
    render(
      <ToastProvider>
        <MemberCoupons
          member={{ id: 'm1', name: '甲会员', enabled: true }}
          canIssue
          onClose={vi.fn()}
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '作废此券' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认作废' }));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('/coupons/members/m1/coupons/c1'),
    );
  });

  it('跨页全选发券提交条件，不把当前页冒充全部会员', async () => {
    mocks.post.mockResolvedValue({ data: { data: { count: 25 } } });
    const issued = vi.fn();
    render(
      <ToastProvider>
        <CouponIssuer target={{ mode: 'ALL', keyword: '测试' }} onIssued={issued} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText('发券模板'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认发券' }));
    await waitFor(() => expect(issued).toHaveBeenCalled());
    expect(mocks.post).toHaveBeenCalledWith(
      '/coupons/batches',
      expect.objectContaining({
        mode: 'ALL',
        keyword: '测试',
        templateId: 't1',
        requestId: expect.any(String),
      }),
    );
    expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('memberIds');
  });
});
