import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
type Template = { id: string; name: string; deletedAt: Date | null; startsAt: Date; endsAt: Date };
type OwnedCoupon = {
  id: string;
  memberId: string;
  status: string;
  orderId: string | null;
  template: { name: string; startsAt: Date; endsAt: Date; minimumSpend: Prisma.Decimal };
};
// 【发放反馈】未开始模板允许预先发券；只有营销启用检查要求已经生效，保持原规则。
export function assertTemplateIssuable(
  template: Template | null,
  now = new Date(),
  requireStarted = false,
): asserts template is Template {
  if (!template)
    throw new BadRequestException({
      code: 'COUPON_TEMPLATE_NOT_FOUND',
      message: '券模板不存在，请刷新模板列表后重新选择',
      details: [{ reason: 'NOT_FOUND', nextAction: 'SELECT_TEMPLATE' }],
    });
  const context = {
    templateId: template.id,
    templateName: template.name,
    nextAction: 'SELECT_TEMPLATE',
  };
  if (template.deletedAt)
    throw new BadRequestException({
      code: 'COUPON_TEMPLATE_STOPPED',
      message:
        '优惠券“' +
        template.name +
        '”的模板已停止发放，请选择当前有效模板；已发出的券仍按原规则使用',
      details: [{ ...context, reason: 'STOPPED' }],
    });
  if (template.endsAt <= now)
    throw new BadRequestException({
      code: 'COUPON_TEMPLATE_EXPIRED',
      message: '优惠券“' + template.name + '”的模板已过期，请选择有效模板后再发放或补发',
      details: [{ ...context, reason: 'EXPIRED', endsAt: template.endsAt.toISOString() }],
    });
  if (requireStarted && template.startsAt > now)
    throw new BadRequestException({
      code: 'COUPON_TEMPLATE_NOT_STARTED',
      message: '优惠券“' + template.name + '”尚未生效，请选择当前有效模板，或等生效后再启用玩法',
      details: [{ ...context, reason: 'NOT_STARTED', startsAt: template.startsAt.toISOString() }],
    });
}
// 【用券反馈】先核对归属；错误选择与不存在返回相同信息，不泄漏其他会员的券资料。
export function assertCouponUsable(
  coupon: OwnedCoupon | null,
  memberId: string,
  amount: Prisma.Decimal,
  now = new Date(),
): asserts coupon is OwnedCoupon {
  if (!coupon || coupon.memberId !== memberId)
    throw new ConflictException({
      code: 'COUPON_UNAVAILABLE',
      message: '所选优惠券不可用于当前会员，请重新选择该会员持有的券',
      details: [{ reason: 'INVALID_SELECTION', nextAction: 'SELECT_COUPON' }],
    });
  const context = {
    couponId: coupon.id,
    couponName: coupon.template.name,
    nextAction: 'SELECT_COUPON',
  };
  const reject = (reason: string, message: string) => {
    throw new ConflictException({
      code: 'COUPON_UNAVAILABLE',
      message: '优惠券“' + coupon.template.name + '”' + message,
      details: [{ ...context, reason }],
    });
  };
  if (coupon.status === 'RESERVED' || (coupon.orderId !== null && coupon.status === 'AVAILABLE'))
    reject('RESERVED', '已被订单占用，请核对该会员的券状态后重新选择');
  if (coupon.status === 'USED') reject('USED', '已核销，请选择其他可用券');
  if (coupon.status === 'VOID') reject('VOID', '已作废，请选择其他可用券');
  if (coupon.status !== 'AVAILABLE') reject('UNAVAILABLE', '当前不可用，请刷新后重新选择');
  if (coupon.template.endsAt <= now) reject('EXPIRED', '已过期，请选择其他可用券');
  if (coupon.template.startsAt > now)
    reject('NOT_STARTED', '尚未生效，请等生效后使用或选择其他可用券');
  if (amount.lt(coupon.template.minimumSpend))
    throw new BadRequestException({
      code: 'COUPON_MINIMUM_NOT_MET',
      message:
        '订单商品原价合计为¥' +
        amount.toFixed(2) +
        '，优惠券“' +
        coupon.template.name +
        '”需满¥' +
        coupon.template.minimumSpend.toFixed(2) +
        '，还差¥' +
        coupon.template.minimumSpend.minus(amount).toFixed(2),
      details: [
        {
          ...context,
          reason: 'MINIMUM_NOT_MET',
          originalAmount: amount.toFixed(2),
          minimumSpend: coupon.template.minimumSpend.toFixed(2),
          shortfall: coupon.template.minimumSpend.minus(amount).toFixed(2),
          nextAction: 'ADJUST_CART_OR_COUPON',
        },
      ],
    });
}
