'use client';

import {
  Building2,
  CircleDollarSign,
  ShoppingBasket,
  Info,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppSelector } from '@/store/store';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Card,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  Tooltip as InfoTooltip,
} from '../components/ui';
import { useApi } from '../hooks/use-api';
import type { PageResult } from '../lib/api';

export type Overview = {
  revenue: number;
  orderCount: number;
  averageOrderValue: number;
  activeStores: number;
  productSales: number;
  growthRate: number | null;
};
type Point = { name?: string; date?: string; value?: number; revenue?: number; orders?: number };
export type Charts = {
  trend: Point[];
  storeRanking: Point[];
  productRanking: Point[];
  categoryShare: Point[];
  hourly: Point[];
};
const colors = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];
const money = (value: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value);
export default function DashboardView({
  initialOverview,
  initialCharts,
}: {
  initialOverview: Overview | null;
  initialCharts: Charts | null;
}) {
  const [days, setDays] = useState('30');
  const [regionId, setRegionId] = useState('');
  const [storeId, setStoreId] = useState('');
  const endDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const startDate = useMemo(
    () =>
      new Date(
        new Date(endDate + 'T00:00:00+08:00').getTime() - (Number(days) - 1) * 86400000,
      ).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
    [days, endDate],
  );
  const query = `?startDate=${startDate}&endDate=${endDate}${regionId ? `&regionId=${regionId}` : ''}${storeId ? `&storeId=${storeId}` : ''}`;
  const overview = useApi<Overview>(`/metrics/overview${query}`, initialOverview);
  const charts = useApi<Charts>(`/metrics/charts${query}`, initialCharts);
  const permissions = useAppSelector((s) => s.auth.user?.permissions || []);
  const dailyTrend = Array.from({ length: Number(days) }, (_, i) => {
    const date = new Date(
      new Date(startDate + 'T00:00:00+08:00').getTime() + i * 86400000,
    ).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    return charts.data?.trend.find((p) => p.date === date) || { date, revenue: 0, orders: 0 };
  });
  const regions = useApi<{ id: string; name: string }[]>('/regions');
  const stores =
    useApi<PageResult<{ id: string; name: string; regionId: string; enabled: boolean }>>(
      '/stores?pageSize=100',
    );
  const cards = overview.data
    ? [
        {
          label: '营业额',
          value: money(overview.data.revenue),
          icon: CircleDollarSign,
          accent: 'bg-orange-100 text-orange-800',
        },
        {
          label: '订单量',
          value: overview.data.orderCount.toLocaleString(),
          icon: ReceiptText,
          accent: 'bg-slate-tint text-slate-tone',
        },
        {
          label: '平均客单价',
          value: money(overview.data.averageOrderValue),
          icon: ShoppingBag,
          accent: 'bg-ochre-tint text-ochre',
        },
        {
          label: '在营门店',
          value: `${overview.data.activeStores} 家`,
          icon: Building2,
          accent: 'bg-tea-tint text-tea',
        },
        {
          label: '商品销量',
          value: `${overview.data.productSales} 件`,
          icon: ShoppingBasket,
          accent: 'bg-sunken text-ink-muted',
        },
        {
          label: '营业额环比',
          value:
            overview.data.growthRate === null
              ? '暂无上期基数'
              : `${overview.data.growthRate > 0 ? '+' : ''}${overview.data.growthRate}%`,
          icon: TrendingUp,
          accent: 'bg-orange-50 text-orange-900',
        },
      ]
    : [];
  const filter = (
    <div className="flex flex-wrap gap-2">
      <Select
        value={regionId}
        onChange={(e) => {
          setRegionId(e.target.value);
          setStoreId('');
        }}
      >
        <option value="">全部区域</option>
        {regions.data?.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
      <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
        <option value="">全部门店</option>
        {stores.data?.items
          .filter((s) => s.enabled && (!regionId || s.regionId === regionId))
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </Select>
      <Select value={days} onChange={(e) => setDays(e.target.value)}>
        <option value="7">最近7天</option>
        <option value="14">最近14天</option>
        <option value="30">最近30天</option>
        <option value="60">最近60天</option>
      </Select>
    </div>
  );
  return (
    <>
      <PageHeader
        title="经营总览"
        description="查看经营表现，掌握需要处理的订单与库存事项"
        action={filter}
      />
      <Card className="mb-5 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">运营待办</h2>
            <p className="mt-1 text-xs text-ink-muted">
              当前账号可见的全部业务范围；不随下方经营统计的日期和门店筛选变化。
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-brand">
            <Link href="/agent">AI 运营助手 →</Link>
            {permissions.includes('member:view') && <Link href="/members">会员管理 →</Link>}
            {permissions.includes('metric:view') && <Link href="/metrics">指标口径 →</Link>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {permissions.includes('order:view') && <OrderTasks />}
          {permissions.includes('product:view') && <StockTask />}
        </div>
      </Card>
      <p className="mb-3 text-xs text-ink-muted">
        经营统计 · {startDate} 至 {endDate}（上海日期）·
        营业额和订单量仅统计已完成订单，已支付未完成、取消及整单退款不计入。
      </p>
      {overview.loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : overview.error ? (
        <ErrorState message={overview.error} retry={overview.reload} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {cards.map((item) => (
            <Card key={item.label} className="brand-kpi p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1 text-sm text-ink-muted">
                    {item.label}
                    <InfoTooltip content="随当前日期、区域和门店筛选条件动态计算">
                      <button aria-label={`${item.label}说明`}>
                        <Info size={13} />
                      </button>
                    </InfoTooltip>
                  </div>
                  <div className="brand-kpi-value mt-3 text-[28px] font-semibold leading-none tracking-tight text-ink tabular-nums">
                    {item.value}
                  </div>
                </div>
                <div className={`grid h-10 w-10 place-items-center rounded-md ${item.accent}`}>
                  <item.icon size={20} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {charts.loading ? (
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : charts.error ? (
        <ErrorState message={charts.error} retry={charts.reload} />
      ) : (
        charts.data && (
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
            <Chart
              title="营业额趋势"
              subtitle="按天统计已完成订单实付金额"
              className="lg:col-span-8"
            >
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyTrend}>
                  <defs>
                    <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12 }}
                    formatter={(value) => money(Number(value))}
                  />
                  <Area
                    type="linear"
                    dataKey="revenue"
                    stroke="var(--chart-1)"
                    strokeWidth={2.5}
                    fill="url(#revenue)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Chart>
            <Chart
              title="分类销售占比"
              subtitle="各分类商品行原价金额（未分摊优惠）"
              className="lg:col-span-4"
            >
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={charts.data.categoryShare}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={62}
                    outerRadius={96}
                    paddingAngle={4}
                  >
                    {charts.data.categoryShare.map((_, i) => (
                      <Cell key={i} fill={colors[i % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Legend iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </Chart>
            <Chart title="门店营业额排行" subtitle="表现最佳的门店" className="lg:col-span-6">
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={charts.data.storeRanking} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--line)" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={86} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Chart>
            <Chart title="商品销量排行" subtitle="最受欢迎的商品" className="lg:col-span-6">
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={charts.data.productRanking}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(value) => [`${value} 件`, '销量']} />
                  <Bar dataKey="value" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Chart>
            <Chart title="小时段订单分布" subtitle="一天中订单活跃时段" className="lg:col-span-12">
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={charts.data.hourly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(value) => [`${value} 笔`, '订单量']} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="var(--chart-3)"
                    strokeWidth={2.5}
                    dot={{ fill: 'var(--chart-3)' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Chart>
          </div>
        )
      )}
    </>
  );
}
function Chart({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`${className} min-w-0 p-5`}>
      <h3 className="font-semibold text-ink ">{title}</h3>
      <p className="mb-5 mt-1 text-xs text-ink-faint">{subtitle}</p>
      {children}
    </Card>
  );
}

function TaskLink({
  href,
  title,
  count,
  note,
}: {
  href: string;
  title: string;
  count: string | number;
  note: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-line bg-sunken p-4 transition hover:border-brand hover:bg-brand-tint"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{title}</span>
        <strong className="text-2xl text-brand">{count}</strong>
      </div>
      <p className="mt-2 text-xs text-ink-muted">{note} →</p>
    </Link>
  );
}
function OrderTasks() {
  const result = useApi<{ statusCounts: Record<string, number> }>('/orders?page=1&pageSize=5');
  return (
    <>
      {[
        ['PENDING_PAYMENT', '待支付订单', '查看支付时限与处理入口'],
        ['PAID', '待履约订单', '核对待发货、待收货及退款处理中订单'],
      ].map(([status, title, note]) => (
        <TaskLink
          key={status}
          href={'/orders?status=' + status}
          title={title}
          count={
            result.loading
              ? '…'
              : result.error
                ? '—'
                : result.data
                  ? (result.data.statusCounts?.[status] ?? 0)
                  : '—'
          }
          note={result.error ? '暂未取得数量，进入列表核对' : note}
        />
      ))}
    </>
  );
}
function StockTask() {
  const result = useApi<{ total: number }>('/products?state=warning&page=1&pageSize=5');
  return (
    <TaskLink
      href="/products?state=warning"
      title="库存预警商品"
      count={result.loading ? '…' : result.error ? '—' : (result.data?.total ?? '—')}
      note="全平台共享库存，查看低库存与缺货商品"
    />
  );
}
