export type CouponTemplate = {
  id: string;
  name: string;
  minimumSpend: string;
  discountAmount: string;
  startsAt: string;
  endsAt: string;
  version: number;
};
export type BulkCouponTarget =
  { mode: 'ALL'; keyword: string } | { mode: 'SELECTED'; memberIds: string[] };
export type MemberCoupon = {
  id: string;
  status: 'AVAILABLE' | 'RESERVED' | 'USED' | 'VOID';
  displayStatus: 'AVAILABLE' | 'RESERVED' | 'USED' | 'EXPIRED' | 'NOT_STARTED' | 'VOID';
  createdAt: string;
  template: CouponTemplate;
};
export const couponStatusText = {
  AVAILABLE: '可用',
  RESERVED: '待支付占用',
  USED: '已核销',
  EXPIRED: '已过期',
  NOT_STARTED: '未生效',
  VOID: '已作废',
};
