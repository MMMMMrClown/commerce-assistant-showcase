'use client';
import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, errorMessage, type PageResult } from '@/lib/api';
import { money } from '@/lib/orders';
import { seckillState, type SeckillActivity } from '@/lib/seckill';
import { useAppSelector } from '@/store/store';
import {
  Badge,
  Table,
  Th,
  Td,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  StatusTabs,
  useToast,
} from '@/components/ui';
import { CreateOrderDialog } from '@/components/orders/create-order-dialog';
import { OrderDetail } from '@/components/orders/order-detail';
import { ProductThumbnail } from '@/components/product-thumbnail';

// 秒杀状态标签页：key 对应 seckillState 展示状态，空字符串代表全部活动
const STATE_TABS = [
  { key: '', label: '全部' },
  { key: '进行中', label: '进行中' },
  { key: '未开始', label: '未开始' },
  { key: '已抢完', label: '已抢完' },
  { key: '已结束', label: '已结束' },
  { key: '已停用', label: '已停用' },
] as const;
// 状态徽章配色：进行中=green，未开始=amber，其余结束态=neutral
const STATE_TONES: Record<string, 'green' | 'amber' | 'neutral'> = {
  进行中: 'green',
  未开始: 'amber',
  已抢完: 'neutral',
  已结束: 'neutral',
  已停用: 'neutral',
};

export default function SeckillView() {
  // 【列表查询与权限】活动配置需要管理权限，下单沿用订单创建权限。
  const result = useApi<SeckillActivity[]>('/seckill/activities');
  const canManage = useAppSelector(
    (s) => s.auth.user?.permissions.includes('seckill:manage') ?? false,
  );
  const canBuy = useAppSelector((s) => s.auth.user?.permissions.includes('order:create') ?? false);
  const [creating, setCreating] = useState(false);
  const [buying, setBuying] = useState<SeckillActivity | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [state, setState] = useState('');
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const { toast } = useToast();
  const reload = result.reload;
  useEffect(() => {
    // 【活动刷新】定时更新活动时间状态和剩余名额，离开页面时清理定时器。
    const timer = setInterval(() => {
      setNow(Date.now());
      void reload();
    }, 15000);
    return () => clearInterval(timer);
  }, [reload]);
  // 【状态筛选与计数】活动接口一次性返回全量数组，直接在前端按展示状态过滤并统计各状态数量。
  const activities = result.data ?? [];
  const filtered = state
    ? activities.filter((activity) => seckillState(activity, now) === state)
    : activities;
  useEffect(() => {
    if (!result.data) return;
    const data = result.data;
    const tally: Record<string, number> = { '': data.length };
    STATE_TABS.forEach((tab) => {
      if (tab.key) tally[tab.key] = data.filter((a) => seckillState(a, now) === tab.key).length;
    });
    setCounts(tally);
  }, [result.data, now]);
  async function toggle(activity: SeckillActivity) {
    if (changing) return;
    setChanging(activity.id);
    try {
      await api.patch('/seckill/activities/' + activity.id, { enabled: !activity.enabled });
      void reload();
    } catch (err) {
      toast({ title: '操作失败', description: errorMessage(err), variant: 'error' });
    } finally {
      setChanging(null);
    }
  }
  return (
    <>
      <PageHeader
        title="限量秒杀"
        description="后台代会员抢购：每会员每活动限购1件，独立名额，不叠加其他优惠"
        action={
          canManage ? <Button onClick={() => setCreating(true)}>新建秒杀活动</Button> : undefined
        }
      />
      <StatusTabs
        tabs={STATE_TABS.map((t) => ({ key: t.key, label: t.label }))}
        counts={counts}
        value={state}
        onChange={setState}
      />
      <div className="mb-4 flex items-center gap-3">
        <Button
          variant="outline"
          onClick={() => {
            setNow(Date.now());
            void reload();
          }}
        >
          刷新活动
        </Button>
        {state && (
          <Button variant="ghost" onClick={() => setState('')}>
            <RotateCcw size={15} />
            重置
          </Button>
        )}
        <p className="text-sm text-ink-muted">创建订单后限时占用，取消或到期自动归还名额。</p>
      </div>
      {/* 【列表展示】展示可用名额和有效时间，服务端仍是下单资格的最终判断方。 */}
      {result.error ? (
        <ErrorState message={result.error} retry={reload} />
      ) : !result.data && result.loading ? (
        <LoadingState />
      ) : !filtered.length ? (
        <EmptyState text={state ? '暂无该状态的秒杀活动' : '暂无秒杀活动，请先新建活动'} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                {[
                  '活动 / 商品',
                  '商品现价',
                  '秒杀价',
                  '剩余 / 总名额',
                  '活动时间',
                  '状态',
                  '操作',
                ].map((t) => (
                  <Th key={t}>{t}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((activity) => (
                <tr key={activity.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <ProductThumbnail
                        name={activity.product.name}
                        imageUrl={activity.product.imageUrl}
                        compact
                      />
                      <div>
                        <p className="font-medium">{activity.name}</p>
                        <p className="mt-1 text-xs text-ink-muted">{activity.product.name}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>{money(activity.product.price)}</Td>
                  <Td>
                    <span className="font-semibold text-orange-700">{money(activity.price)}</span>
                  </Td>
                  <Td>
                    {activity.remainingStock} / {activity.stock}
                    <p className="text-xs text-ink-muted">占用后{activity.holdMinutes}分钟内支付</p>
                  </Td>
                  <Td>
                    <p className="text-xs">{new Date(activity.startsAt).toLocaleString('zh-CN')}</p>
                    <p className="text-xs text-ink-muted">
                      至 {new Date(activity.endsAt).toLocaleString('zh-CN')}
                    </p>
                  </Td>
                  <Td>
                    <Badge tone={STATE_TONES[seckillState(activity, now)] || 'neutral'}>
                      <span className="whitespace-nowrap">{seckillState(activity, now)}</span>
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      {canBuy && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            seckillState(activity, now) !== '进行中' || !activity.product.enabled
                          }
                          onClick={() => setBuying(activity)}
                        >
                          代客下单
                        </Button>
                      )}
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!changing}
                          onClick={() => void toggle(activity)}
                        >
                          {activity.enabled ? '停用活动' : '启用活动'}
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {creating && (
        <ActivityForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}
      {/* 【秒杀下单入口】固定活动和一件商品，复用报价、幂等创建和结果未知重试。 */}
      {buying && (
        <CreateOrderDialog
          seckillActivity={buying}
          onClose={() => setBuying(null)}
          onCreated={(id) => {
            setBuying(null);
            setOrderId(id);
            void reload();
            toast({ title: '秒杀待支付订单已创建', variant: 'success' });
          }}
        />
      )}
      {orderId && <OrderDetail id={orderId} onClose={() => setOrderId(null)} />}
    </>
  );
}

function ActivityForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  // 【商品查询】按名称搜索可选商品；活动发布后不改价、不追加库存，避免影响已确认规则。
  const [keyword, setKeyword] = useState('');
  const products = useApi<
    PageResult<{ id: string; name: string; enabled: boolean; category: { enabled: boolean } }>
  >('/products?pageSize=100&enabled=true&keyword=' + encodeURIComponent(keyword));
  const [form, setForm] = useState({
    name: '',
    productId: '',
    price: '9.9',
    stock: 10,
    holdMinutes: 5,
    startsAt: '',
    endsAt: '',
  });
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  async function save() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      // 【发布接口】时间转成统一格式，后端再次校验商品和活动价；不接受前端自定义剩余库存。
      await api.post('/seckill/activities', {
        ...form,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      title="新建秒杀活动"
      description="发布后价格、时间和总量固定；需要更换规则时停用旧活动并新建"
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={saving} className="space-y-3">
          {/* 【输入校验】限制名称、金额、名额、占用时长及有效期，后端独立校验。 */}
          <label className="block text-sm">
            活动名称
            <Input
              required
              minLength={2}
              maxLength={40}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            搜索商品
            <Input
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setForm({ ...form, productId: '' });
              }}
            />
          </label>
          <label className="block text-sm">
            活动商品
            <Select
              className="w-full"
              required
              value={form.productId}
              onChange={(e) => setForm({ ...form, productId: e.target.value })}
            >
              <option value="">请选择商品</option>
              {products.data?.items
                .filter((p) => p.enabled && p.category.enabled)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </label>
          <label className="block text-sm">
            秒杀价（元）
            <Input
              type="number"
              required
              min="0.01"
              step="0.01"
              max="99999999.99"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            独立名额
            <Input
              type="number"
              required
              min={1}
              max={100000}
              step={1}
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            待支付占用分钟
            <Input
              type="number"
              required
              min={1}
              max={30}
              step={1}
              value={form.holdMinutes}
              onChange={(e) => setForm({ ...form, holdMinutes: Number(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            开始时间
            <Input
              type="datetime-local"
              required
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            结束时间
            <Input
              type="datetime-local"
              required
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </label>
        </fieldset>
        {products.error && <ErrorState message={products.error} retry={products.reload} />}
        {error && (
          <p role="alert" className="text-sm text-brick">
            {error}
          </p>
        )}
        <Button type="submit" disabled={saving || products.loading || !!products.error}>
          {saving ? '保存中…' : '发布活动'}
        </Button>
      </form>
    </Dialog>
  );
}
