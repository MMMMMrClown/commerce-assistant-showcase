import { retailLabel } from '@/lib/retail-labels';
import { discountText } from '@/lib/member-benefits';
import { money, type BenefitSnapshot } from '@/lib/orders';

// 【分段金额展示】预览和订单详情复用后端快照，不在浏览器重新计算折扣。
export function BenefitPricing({ snapshot }: { snapshot: BenefitSnapshot | null }) {
  if (snapshot?.pricingMode !== 'PROGRESSIVE' || !snapshot.segments?.length) return null;
  return (
    <div className="my-3 space-y-1 rounded-lg border border-orange-200 p-3 text-xs dark:border-orange-900">
      <p className="font-medium">
        会员分段计价 · 下单前累计有效实付 {money(snapshot.growthBase ?? '0')}
      </p>
      {snapshot.segments.map((part, index) => (
        <p key={index}>
          {retailLabel(part.tierName)}：{money(part.originalAmount)} ×{' '}
          {discountText(part.discountBps)} → {money(part.payableAmount)}
        </p>
      ))}
      <p className="text-ink-muted">
        本单实付达到下一档门槛后，剩余部分立即享受下一档折扣；支付成功后更新成长。
      </p>
    </div>
  );
}
