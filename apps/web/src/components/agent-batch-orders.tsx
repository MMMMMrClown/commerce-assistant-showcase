import Link from 'next/link';

export type BatchPreview = {
  storeName: string;
  productName: string;
  activityName?: string;
  benefitMode: string;
  quantityPerMember: number;
  totalAmount: string;
  rows: {
    member: { id: string; name: string; maskedPhone: string };
    originalAmount: string;
    discountAmount: string;
    payableAmount: string;
  }[];
};
export type BatchOutcome = {
  succeeded: number;
  failed: number;
  pending: number;
  rows: { memberId: string; status: string; id?: string; orderNo?: string; message?: string }[];
};
export function AgentBatchOrders({
  batch,
  result,
}: {
  batch: BatchPreview;
  result?: BatchOutcome;
}) {
  const modes: Record<string, string> = { MEMBER: '会员优惠', NONE: '无优惠', SECKILL: '秒杀优惠' };
  const statuses: Record<string, string> = {
    SUCCEEDED: '已建单',
    FAILED: '未创建',
    UNKNOWN: '结果待核对',
    PENDING: '尚未处理',
  };
  return (
    <div className="my-3 space-y-2">
      <p>
        门店：{batch.storeName} · 商品：{batch.productName}
      </p>
      <p>
        {modes[batch.benefitMode]}
        {batch.activityName ? ` · 活动：${batch.activityName}` : ''}
      </p>
      <p>
        随机选择已有会员 {batch.rows.length} 位，每人 {batch.quantityPerMember} 件、一人一单；合计 ¥
        {batch.totalAmount}
      </p>
      <p className="text-xs text-ink-muted">
        名单已固定。确认仅授权下列订单，建单后仍待支付。价格、资格或库存变化时逐笔拒绝，不会自动换人。
      </p>
      {result && (
        <p role="status">
          已创建 {result.succeeded} 笔，未创建 {result.failed} 笔，待核对/处理 {result.pending} 笔。
          {result.failed > 0 ? '未全部完成；失败项需重新预览确认。' : ''}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              <th>会员</th>
              <th>手机号</th>
              <th>原价</th>
              <th>优惠</th>
              <th>应付</th>
              {result && <th>执行结果</th>}
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((row) => {
              const outcome = result?.rows.find((r) => r.memberId === row.member.id);
              return (
                <tr key={row.member.id}>
                  <td className="py-2">{row.member.name}</td>
                  <td>{row.member.maskedPhone}</td>
                  <td>¥{row.originalAmount}</td>
                  <td>¥{row.discountAmount}</td>
                  <td>¥{row.payableAmount}</td>
                  {result && (
                    <td>
                      {outcome ? statuses[outcome.status] || outcome.status : '尚未处理'}{' '}
                      {outcome?.orderNo && (
                        <Link className="underline" href="/orders">
                          {outcome.orderNo}
                        </Link>
                      )}
                      {outcome?.message && (
                        <span className="block text-brick">{outcome.message}</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
