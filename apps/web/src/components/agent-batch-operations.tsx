import Link from 'next/link';
export type BatchOperationPreview = {
  title: string;
  simulated?: boolean;
  rows: {
    actionId: string;
    kind: string;
    label: string;
    payload: {
      fields?: { label: string; before: unknown; after: unknown }[];
      input?: Record<string, unknown>;
      summary?: {
        name?: string;
        templateName?: string;
        minimumSpend?: string;
        discountAmount?: string;
        startsAt?: string;
        endsAt?: string;
        recipients?: { name: string; maskedPhone: string }[];
      };
      reason?: string;
      noChange?: boolean;
      order?: { orderNo: string; status: string; payableAmount?: string };
      member?: { name: string; maskedPhone: string };
      quote?: {
        memberName: string;
        storeName: string;
        payableAmount: string;
        discountAmount: string;
        items: { productName: string; quantity: number }[];
      };
    };
  }[];
};
export type BatchOperationOutcome = {
  succeeded: number;
  failed: number;
  pending: number;
  rows: {
    actionId: string;
    status: string;
    message?: string;
    result?: { id?: string; orderNo?: string; status?: string; failure?: { message: string } };
  }[];
};
const value = (v: unknown): string =>
  v === undefined || v === null
    ? '—'
    : typeof v === 'boolean'
      ? v
        ? '是'
        : '否'
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);
const inputLabels: Record<string, string> = {
  name: '名称',
  code: '编号',
  phone: '手机号',
  maskedPhone: '手机号',
  price: '售价',
  costPrice: '成本',
  categoryId: '分类',
  enabled: '启用',
  startsAt: '开始时间',
  endsAt: '结束时间',
  stock: '名额',
  minimumSpend: '使用门槛',
  discountAmount: '减免金额',
  quantity: '现存量',
  reason: '原因',
  warning: '预警值',
  imageUrl: '图片地址',
  holdMinutes: '占用分钟',
};
export function AgentBatchOperations({
  batch,
  result,
  labels,
}: {
  batch: BatchOperationPreview;
  result?: BatchOperationOutcome;
  labels: Record<string, string>;
}) {
  const statuses: Record<string, string> = {
    SUCCEEDED: '已完成',
    FAILED: '未完成',
    UNKNOWN: '结果待核对',
    EXECUTING: '执行中',
    PENDING: '尚未处理',
  };
  return (
    <div className="my-3 space-y-3">
      <p className="font-medium">
        {batch.title} · 共 {batch.rows.length} 项
      </p>
      {batch.simulated && (
        <p className="text-brick">
          生成的是模拟会员资料，名称标明“模拟”，000开头号码为占位联系方式；确认后会实际写入会员档案。
        </p>
      )}
      <p className="text-xs text-ink-muted">
        对象与参数已固定。确认仅授权下列操作；逐项复核业务规则，成功项不会重复执行，失败不会自动换人或换商品。
      </p>
      {result && (
        <p role="status">
          已完成 {result.succeeded} 项，未完成 {result.failed} 项，待核对/处理 {result.pending} 项。
          {result.failed > 0 ? '未全部完成，请核对逐项原因。' : ''}
        </p>
      )}
      {batch.rows.map((row, index) => {
        const outcome = result?.rows.find((r) => r.actionId === row.actionId);
        const p = row.payload;
        return (
          <details key={row.actionId} open className="rounded-xl border border-orange-200/60 p-3">
            <summary className="cursor-pointer font-medium">
              {index + 1}. {labels[row.kind] || '业务操作'} ·{' '}
              {p.summary?.name ||
                p.summary?.templateName ||
                p.member?.name ||
                p.quote?.memberName ||
                p.order?.orderNo ||
                String(p.input?.name || '')}
              {outcome
                ? ` · ${outcome.result?.status === 'UNCHANGED' ? '无需修改' : statuses[outcome.status] || outcome.status}`
                : p.noChange
                  ? ' · 当前已为目标值'
                  : ''}
            </summary>
            {['PAYMENT', 'REFUND'].includes(row.kind) && (
              <p className="text-xs text-ink-muted">仅发起MOCK申请，不代表支付或退款成功。</p>
            )}
            {outcome?.result?.status === 'UNCHANGED' && (
              <p className="text-xs text-ink-muted">当前已是目标值，无需修改。</p>
            )}
            {p.member && (
              <p className="mt-2">
                {p.member.name} · {p.member.maskedPhone}
              </p>
            )}
            {p.order && (
              <p className="mt-2">
                订单 {p.order.orderNo} · 状态 {p.order.status}
                {p.order.payableAmount ? ` · 应付 ¥${p.order.payableAmount}` : ''}
              </p>
            )}
            {p.reason && <p className="my-2 text-xs">原因：{p.reason}</p>}
            {p.summary?.minimumSpend && (
              <p className="my-2 text-xs">
                满 ¥{p.summary.minimumSpend} 减 ¥{p.summary.discountAmount}；有效期{' '}
                {p.summary.startsAt} 至 {p.summary.endsAt}
              </p>
            )}
            {p.fields ? (
              <table className="my-2 w-full text-left text-xs">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>原值</th>
                    <th>修改后</th>
                  </tr>
                </thead>
                <tbody>
                  {p.fields.map((f, i) => (
                    <tr key={i}>
                      <td>{f.label}</td>
                      <td className="break-all">{value(f.before)}</td>
                      <td className="break-all">{value(f.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : p.quote ? (
              <div className="my-2">
                <p>
                  会员：{p.quote.memberName} · 门店：{p.quote.storeName}
                </p>
                {p.quote.items.map((i, n) => (
                  <p key={n}>
                    {i.productName} × {i.quantity}
                  </p>
                ))}
                <p>
                  优惠 ¥{p.quote.discountAmount} · 应付 ¥{p.quote.payableAmount}
                </p>
              </div>
            ) : (
              <div className="my-2 text-xs">
                {Object.entries(p.input || {})
                  .filter(([k]) => inputLabels[k])
                  .map(([k, v]) => (
                    <p key={k}>
                      {inputLabels[k]}：{value(v)}
                    </p>
                  ))}
              </div>
            )}
            {p.summary?.recipients && (
              <div className="my-2 text-xs">
                <p>发券对象 {p.summary.recipients.length} 位：</p>
                {p.summary.recipients.map((m, i) => (
                  <p key={i}>
                    {m.name} · {m.maskedPhone}
                  </p>
                ))}
              </div>
            )}
            {(outcome?.message || outcome?.result?.failure?.message) && (
              <p className="text-brick">{outcome.message || outcome.result?.failure?.message}</p>
            )}
            {outcome?.result?.orderNo && <p>订单：{outcome.result.orderNo}</p>}
            {outcome?.status === 'SUCCEEDED' && (
              <Link
                className="text-xs underline"
                href={
                  row.kind.includes('MEMBER') || row.kind.startsWith('COUPON_')
                    ? '/members'
                    : row.kind.startsWith('PRODUCT_')
                      ? '/products'
                      : row.kind.includes('SECKILL')
                        ? '/seckill'
                        : row.kind.startsWith('ROLE_')
                          ? '/system/roles'
                          : row.kind.startsWith('USER_')
                            ? '/system/users'
                            : row.kind.startsWith('STORE_') || row.kind.startsWith('REGION_')
                              ? '/stores'
                              : '/orders'
                }
              >
                前往业务页面查看
              </Link>
            )}
          </details>
        );
      })}
    </div>
  );
}
