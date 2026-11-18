type Evidence = { name?: string; queriedAt: string; scope?: string; result?: unknown };
const row = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const scalar = (v: unknown) =>
  typeof v === 'boolean'
    ? v
      ? '启用'
      : '停用'
    : typeof v === 'string' || typeof v === 'number'
      ? String(v)
      : v === null
        ? '暂无可比基数'
        : '—';
const labels: Record<string, string> = {
  revenue: '销售额（元）',
  orderCount: '订单量',
  averageOrderValue: '客单价（元）',
  productSales: '商品销量（件）',
  periodOverPeriodGrowthPercent: '等长上期环比（%）',
  operatingStoreCount: '在营门店数',
  total: '记录总数',
  enabled: '启用数量/状态',
  newMembers: '区间新增会员',
  points: '积分',
  totalSpent: '累计消费（元）',
  tierName: '会员等级',
  maskedPhone: '手机号（脱敏）',
  name: '名称',
  orderNo: '订单号',
  status: '状态',
  price: '售价（元）',
  payableAmount: '应付（元）',
  paidAmount: '实付（元）',
  amount: '金额（元）',
  count: '数量',
  paymentCount: '支付笔数',
  effectivePaidOrders: '有效成交订单',
  orders: '订单量',
  discount: '优惠金额（元）',
  refundCount: '退款笔数',
  totalRows: '文件行数',
  successRows: '通过行数',
  failedRows: '错误项数',
  fileName: '文件名称',
  version: '规则版本',
  minimumSpend: '使用门槛（元）',
  discountAmount: '优惠金额（元）',
};
const tables: Record<string, string> = {
  items: '业务记录',
  candidates: '会员匹配结果',
  productRanking: '商品销量排行（件）',
  storeRanking: '门店实付排行（元）',
  categoryDistribution: '分类商品行原价（元，非实付分摊）',
  salesTrend: '每日销售',
  hourlyDistribution: '小时订单分布',
  activities: '活动配置',
  sources: '规则来源',
  tiers: '会员等级规则',
  payments: '支付统计（MOCK）',
  refunds: '退款统计（MOCK）',
};
const columns: Record<string, string> = {
  name: '名称',
  code: '编号',
  orderNo: '订单号',
  price: '售价（元）',
  enabled: '启用状态',
  status: '状态',
  category: '分类',
  quantity: '件数',
  value: '统计值',
  count: '笔数',
  amount: '金额（元）',
  channel: '渠道',
  date: '日期',
  revenue: '销售额（元）',
  orders: '订单量',
  payableAmount: '应付（元）',
  paidAmount: '实付（元）',
  maskedPhone: '手机号（脱敏）',
  section: '规则章节',
  ruleVersion: '规则版本',
  minimumSpend: '门槛（元）',
  discountBps: '折扣万分比',
  pointsPerYuan: '每元积分',
  startsAt: '开始时间',
  endsAt: '结束时间',
  durationHours: '持续小时',
};
function DataTable({ items }: { items: unknown[] }) {
  const rows = items.slice(0, 10).map((value): Record<string, unknown> => {
      const r = row(value);
      return { ...r, amount: r.amount ?? row(r._sum).amount, count: r.count ?? row(r._count)._all };
    }),
    keys = Object.keys(columns)
      .filter((k) => rows.some((r) => r[k] !== undefined))
      .slice(0, 6);
  if (!rows.length) return <p className="text-ink-faint">暂无记录</p>;
  if (!keys.length) return <p>返回 {items.length} 条结果。</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              {keys.map((k) => (
                <th className="border-b border-line px-2 py-2 font-medium" key={k}>
                  {columns[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {keys.map((k) => (
                  <td className="border-b border-line/60 px-2 py-2" key={k}>
                    {k === 'category' ? scalar(row(r[k]).name) : scalar(r[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 10 && (
        <p className="mt-2 text-ink-faint">摘要展示前10条，共返回{items.length}条。</p>
      )}
    </>
  );
}
function DataSummary({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const source = row(value),
    data = source.result && typeof source.result === 'object' ? row(source.result) : source;
  const period = row(data.period),
    metrics = Object.entries(data).filter(
      ([k, v]) => labels[k] && (['string', 'number', 'boolean'].includes(typeof v) || v === null),
    );
  const arrays = Object.entries(data).filter(([k, v]) => tables[k] && Array.isArray(v));
  const nested =
    depth < 2
      ? Object.entries(data).filter(
          ([k, v]) =>
            [
              'current',
              'previous',
              'member',
              'policy',
              'task',
              'groups',
              'distribution',
              'payments',
              'refunds',
            ].includes(k) &&
            v &&
            typeof v === 'object' &&
            !Array.isArray(v),
        )
      : [];
  return (
    <div className="space-y-3">
      {!!period.startDate && !!period.endDate && (
        <p>
          统计区间：{scalar(period.startDate)} 至 {scalar(period.endDate)}
        </p>
      )}
      {!!metrics.length && (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {metrics.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-ink-faint">{labels[k]}</dt>
              <dd>{scalar(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {arrays.map(([k, v]) => (
        <div key={k}>
          <p className="mb-1 font-medium">{tables[k]}</p>
          <DataTable items={v as unknown[]} />
        </div>
      ))}
      {nested.map(([k, v]) => (
        <div key={k}>
          <p className="mb-1 font-medium">
            {
              {
                current: '本期',
                previous: '上期',
                member: '会员资料',
                policy: '权益规则',
                task: '导入任务',
                groups: '营销分组',
                distribution: '会员分布',
                payments: '支付',
                refunds: '退款',
              }[k]
            }
          </p>
          {['groups', 'distribution'].includes(k) ? (
            <dl className="space-y-2">
              {Object.entries(row(v)).map(([name, item]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    {typeof item === 'object' ? (
                      <DataSummary value={item} depth={depth + 1} />
                    ) : (
                      scalar(item)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <DataSummary value={v} depth={depth + 1} />
          )}
        </div>
      ))}
      {typeof data.definition === 'string' && (
        <p className="leading-6 text-ink-faint">口径：{data.definition}</p>
      )}
      {typeof data.message === 'string' && <p>{data.message}</p>}
      {!metrics.length && !arrays.length && !nested.length && !data.definition && !data.message && (
        <p className="text-ink-faint">该查询已返回结果，用于本轮回答；详细调用记录由管理员查看。</p>
      )}
    </div>
  );
}
export function AgentEvidence({ evidence }: { evidence: Evidence[] }) {
  const queries = evidence.filter((e) => !row(e.result).action && !row(e.result).plan);
  if (!queries.length) return null;
  return (
    <details className="mt-4 text-xs text-ink-muted">
      <summary className="cursor-pointer py-2">查看数据依据 · {queries.length}项查询</summary>
      <div className="divide-y divide-line">
        {queries.map((e, i) => (
          <section key={i} className="space-y-3 py-4">
            <p className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">查询 {i + 1}</span>
              <span>查询时间：{new Date(e.queriedAt).toLocaleString('zh-CN')}</span>
            </p>
            <p>数据范围：{e.scope || '当前账号已授权业务范围'}</p>
            <DataSummary value={e.result} />
          </section>
        ))}
      </div>
    </details>
  );
}
