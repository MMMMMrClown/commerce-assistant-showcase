'use client';
import { MemberAvatar } from '@/components/member-avatar';

import axios from 'axios';
import { useRef, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { errorMessage, type PageResult } from '@/lib/api';
import { type MemberCoupon } from '@/lib/coupons';
import type { SeckillActivity } from '@/lib/seckill';
import {
  createOrder,
  money,
  quoteOrder,
  type MemberSummary,
  type OrderInput,
  type Quote,
} from '@/lib/orders';
import { Button, Dialog, ErrorState, Input, Select } from '../ui';
import { BenefitPricing } from './benefit-pricing';

type StoreOption = { id: string; name: string; enabled: boolean };
type ProductOption = { id: string; name: string; enabled: boolean; category: { enabled: boolean } };
type FormState = OrderInput;

export function CreateOrderDialog({
  seckillActivity,
  onClose,
  onCreated,
}: {
  seckillActivity?: SeckillActivity;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState<FormState>({
    benefitMode: seckillActivity ? 'SECKILL' : 'MEMBER',
    activityId: seckillActivity?.id,
    storeId: '',
    memberId: '',
    items: [{ productId: seckillActivity?.productId ?? '', quantity: 1 }],
  });
  const [memberSearch, setMemberSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<'quote' | 'create' | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [couponVersion, setCouponVersion] = useState(0);
  const busy = useRef(false);
  const requestId = useRef<string | null>(null);
  const stores = useApi<PageResult<StoreOption>>('/stores?pageSize=100&enabled=true');
  const members = useApi<PageResult<MemberSummary>>(
    '/members?pageSize=20&enabled=true&keyword=' + encodeURIComponent(memberSearch),
  );
  const products = useApi<PageResult<ProductOption>>(
    '/products?pageSize=100&enabled=true&keyword=' + encodeURIComponent(productSearch),
  );
  // Keep selected products visible when the search query changes.
  const selectedProducts = useRef(new Map<string, ProductOption>());
  products.data?.items.forEach((item) => selectedProducts.current.set(item.id, item));
  const productOptions = [
    ...new Map([
      ...form.items.flatMap((item) => {
        const selected = selectedProducts.current.get(item.productId);
        return selected ? [[selected.id, selected] as const] : [];
      }),
      ...(products.data?.items ?? [])
        .filter((item) => item.enabled && item.category.enabled)
        .map((item) => [item.id, item] as const),
    ]).values(),
  ];

  function change(next: FormState) {
    // 更换会员或优惠方式时清掉旧券，避免把上一位会员的券带入订单。
    if (next.memberId !== form.memberId || next.benefitMode !== 'COUPON')
      next = { ...next, couponId: undefined };
    setForm(next);
    setQuote(null);
    requestId.current = null;
    setError('');
  }

  async function calculate() {
    // 【报价前校验】检查门店、会员、用券选择和商品数量；不通过时只提示，不请求接口。
    if (busy.current) return;
    if (
      !form.storeId ||
      !form.memberId ||
      (form.benefitMode === 'COUPON' && !form.couponId) ||
      form.items.some(
        (item) =>
          !item.productId ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 20,
      )
    ) {
      setError('请选择门店、会员和商品，用券时需选择优惠券；每种商品数量为1～20');
      return;
    }
    busy.current = true;
    setWorking('quote');
    setError('');
    setQuote(null);
    try {
      // 【报价接口与预览】提交商品和优惠选择，保存后端返回的券后金额；此时不创建订单、不占券。
      setQuote(await quoteOrder(form));
      requestId.current = crypto.randomUUID();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      busy.current = false;
      setWorking(null);
    }
  }

  async function submit() {
    // 【创建前校验】必须已有报价和提交标识，并防止连续点击创建。
    if (busy.current || !quote || !requestId.current) return;
    busy.current = true;
    setWorking('create');
    setError('');
    let createdId: string | null = null;
    try {
      // 【创建接口】提交相同报价和标识供后端防重；后端创建订单成功时才绑定优惠券。
      createdId = (await createOrder(form, quote.quoteHash, requestId.current)).id;
      setUncertain(false);
    } catch (error) {
      setError(errorMessage(error));
      if (axios.isAxiosError(error) && (!error.response || error.response.status >= 500)) {
        setUncertain(true);
      } else if (
        axios.isAxiosError<{ code: string }>(error) &&
        [
          'ORDER_QUOTE_CHANGED',
          'COUPON_UNAVAILABLE',
          'SECKILL_UNAVAILABLE',
          'SECKILL_LIMIT',
        ].includes(error.response?.data.code ?? '')
      ) {
        // 【报价失效处理】取消旧预览；券不可用时清空选券，并重新挂载选券区以查询最新可用券。
        setQuote(null);
        requestId.current = null;
        setUncertain(false);
        if (error.response?.data.code === 'COUPON_UNAVAILABLE') {
          setForm((previous) => ({ ...previous, couponId: undefined }));
          setCouponVersion((version) => version + 1);
        }
      } else if (
        axios.isAxiosError<{ code: string }>(error) &&
        error.response?.data.code === 'ORDER_BUSY'
      ) {
        setUncertain(true);
      }
    } finally {
      busy.current = false;
      setWorking(null);
    }
    // 【创建后通知】把订单ID交回列表页面，由外层关闭创建窗口、显示订单详情并刷新列表。
    if (createdId) onCreated(createdId);
  }

  function close() {
    if (working) return;
    if (uncertain && !recoveryId) {
      setError('提交结果尚未确认，请先重试原提交；若需离开，请记下页面显示的提交标识。');
      setRecoveryId(requestId.current);
      return;
    }
    onClose();
  }

  const lookupError = stores.error || members.error || products.error;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={seckillActivity ? '秒杀下单' : '会员下单'}
      description="选择会员和商品，核对金额后创建待支付订单"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void (quote ? submit() : calculate());
        }}
        className="space-y-4"
      >
        <fieldset disabled={!!working || uncertain} className="space-y-4 disabled:opacity-70">
          {/* 【秒杀固定项】活动入口固定商品数量和价格来源，不提供优惠叠加入口。 */}
          {seckillActivity && (
            <p className="rounded-lg bg-orange-50 p-3 text-sm dark:bg-orange-950/30">
              {seckillActivity.name} · {seckillActivity.product.name} × 1 · 活动价{' '}
              {money(seckillActivity.price)}，创建后{seckillActivity.holdMinutes}分钟内支付。
            </p>
          )}
          {!seckillActivity && (
            <label className="block">
              <span className="mb-1.5 block text-sm">会员优惠</span>
              <Select
                className="w-full"
                aria-label="会员优惠"
                value={form.benefitMode ?? 'MEMBER'}
                onChange={(event) =>
                  change({ ...form, benefitMode: event.target.value as OrderInput['benefitMode'] })
                }
              >
                <option value="MEMBER">使用当前会员权益</option>
                <option value="NONE">不使用会员优惠</option>
                <option value="COUPON">使用满减券（不叠加会员折扣）</option>
              </Select>
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm">门店</span>
            <Select
              className="w-full"
              aria-label="门店"
              value={form.storeId}
              onChange={(event) => change({ ...form, storeId: event.target.value })}
            >
              <option value="">请选择门店</option>
              {stores.data?.items
                .filter((store) => store.enabled)
                .map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm">查找会员</span>
            <Input
              aria-label="查找会员"
              placeholder="输入姓名或手机号查找会员"
              value={memberSearch}
              onChange={(event) => {
                setMemberSearch(event.target.value);
                change({ ...form, memberId: '' });
              }}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm">会员</span>
            <Select
              className="w-full"
              aria-label="会员"
              value={form.memberId}
              onChange={(event) => change({ ...form, memberId: event.target.value })}
            >
              <option value="">{members.loading ? '正在查询会员…' : '请选择会员'}</option>
              {!members.loading &&
                members.data?.items
                  .filter((member) => member.enabled)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} · {member.phone}
                    </option>
                  ))}
            </Select>
          </label>
          {members.data?.items
            .filter((m) => m.id === form.memberId)
            .map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <MemberAvatar compact name={m.name} src={m.avatarUrl} />
                <span>{m.name}</span>
              </div>
            ))}
          {/* 【下单选券区】选择满减券模式后，按当前会员查询券；更换会员时重新加载。 */}
          {form.benefitMode === 'COUPON' &&
            (form.memberId ? (
              <CouponSelector
                key={form.memberId + ':' + couponVersion}
                memberId={form.memberId}
                value={form.couponId ?? ''}
                onChange={(couponId) => change({ ...form, couponId })}
              />
            ) : (
              <p className="text-sm text-ink-muted">先选择会员，再选择该会员的满减券。</p>
            ))}
          {!seckillActivity && (
            <>
              <label className="block">
                <span className="mb-1.5 block text-sm">查找商品</span>
                <Input
                  placeholder="输入商品名称"
                  aria-label="查找商品"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                />
              </label>
              <div className="space-y-3">
                {form.items.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select
                      className="min-w-0 flex-1"
                      aria-label={'商品' + (index + 1)}
                      value={item.productId}
                      onChange={(event) =>
                        change({
                          ...form,
                          items: form.items.map((row, i) =>
                            i === index ? { ...row, productId: event.target.value } : row,
                          ),
                        })
                      }
                    >
                      <option value="">请选择商品</option>
                      {productOptions.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label={'数量' + (index + 1)}
                      className="w-20"
                      type="number"
                      min={1}
                      max={20}
                      step={1}
                      value={item.quantity}
                      onChange={(event) =>
                        change({
                          ...form,
                          items: form.items.map((row, i) =>
                            i === index ? { ...row, quantity: Number(event.target.value) } : row,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={form.items.length === 1}
                      aria-label={'删除商品' + (index + 1)}
                      onClick={() =>
                        change({ ...form, items: form.items.filter((_, i) => i !== index) })
                      }
                    >
                      移除
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={form.items.length >= 20}
                  onClick={() =>
                    change({ ...form, items: [...form.items, { productId: '', quantity: 1 }] })
                  }
                >
                  添加商品
                </Button>
              </div>
            </>
          )}
        </fieldset>
        {lookupError && <ErrorState message={lookupError} />}
        {quote && (
          <div className="space-y-2 rounded-xl bg-orange-50 p-4 text-sm dark:bg-orange-950/30">
            <p className="font-medium">
              <span className="flex items-center gap-2">
                <MemberAvatar
                  compact
                  name={quote.memberName}
                  src={members.data?.items.find((m) => m.id === form.memberId)?.avatarUrl}
                />
                {quote.memberName} · {quote.storeName}
              </span>
            </p>
            {quote.items.map((item) => (
              <p key={item.productId} className="flex justify-between gap-2">
                <span>
                  {item.productName} × {item.quantity}
                </span>
                <span>{money(item.subtotal)}</span>
              </p>
            ))}
            <p className="flex justify-between border-t border-orange-200 pt-2 font-semibold">
              <span>应付金额</span>
              <span>{money(quote.payableAmount)}</span>
            </p>
            <p className="flex justify-between text-xs text-ink-muted dark:text-ink-faint">
              <span>
                {quote.seckillSnapshot
                  ? quote.seckillSnapshot.name
                  : quote.couponSnapshot
                    ? quote.couponSnapshot.name
                    : quote.benefitSnapshot.source === 'MEMBER'
                      ? quote.benefitSnapshot.pricingMode === 'PROGRESSIVE'
                        ? '会员分段优惠'
                        : quote.benefitSnapshot.tierName + '折扣'
                      : '无会员优惠'}
              </span>
              <span>
                优惠 {money(quote.discountAmount)} · 原价 {money(quote.originalAmount)}
              </span>
            </p>
            <BenefitPricing snapshot={quote.benefitSnapshot} />
          </div>
        )}
        {quote?.couponSnapshot && (
          <p className="text-xs text-ink-muted">
            当前为券后预览金额；确认创建订单才占用券，支付完成后才核销。
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-brick-tint p-3 text-sm text-brick">
            {error}
          </p>
        )}
        {uncertain && (
          <div className="break-all text-xs text-ink-muted">
            提交标识：{requestId.current}。请重试确认结果，保持表单内容不变。
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" disabled={!!working} onClick={close}>
            关闭
          </Button>
          {quote && !uncertain && (
            <Button type="button" variant="outline" disabled={!!working} onClick={calculate}>
              重新计算
            </Button>
          )}
          <Button
            type="submit"
            disabled={
              !!working || !!lookupError || stores.loading || members.loading || products.loading
            }
          >
            {working === 'quote'
              ? '计算中…'
              : working === 'create'
                ? '创建中…'
                : uncertain
                  ? '重试原提交'
                  : quote
                    ? '确认创建订单'
                    : '计算金额'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// 【下单选券】查询当前会员的券，仅将有效可用券放入下拉框，选中后把券ID交回订单表单。
function CouponSelector({
  memberId,
  value,
  onChange,
}: {
  memberId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  // 【会员券查询接口】返回全部持有券；前端过滤可用项，报价/创建时后端还会再次校验。
  const result = useApi<MemberCoupon[]>('/coupons/members/' + memberId);
  const available = result.data?.filter((coupon) => coupon.displayStatus === 'AVAILABLE') ?? [];
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        会员满减券
        <Select
          className="mt-1 w-full"
          aria-label="会员满减券"
          value={value}
          disabled={result.loading || !!result.error}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{result.loading ? '查询中…' : '请选择可用券'}</option>
          {available.map((coupon) => (
            <option key={coupon.id} value={coupon.id}>
              {coupon.template.name} · 满{coupon.template.minimumSpend}减
              {coupon.template.discountAmount} ·{' '}
              {new Date(coupon.template.endsAt).toLocaleDateString()}到期
            </option>
          ))}
        </Select>
      </label>
      {result.error && <ErrorState message={result.error} retry={result.reload} />}
      {!result.loading && !result.error && !available.length && (
        <p className="text-xs text-ink-muted">
          该会员暂无有效可用券，可到会员管理发券或切换优惠方式。
        </p>
      )}
    </div>
  );
}
