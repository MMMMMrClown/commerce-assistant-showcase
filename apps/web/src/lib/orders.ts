import type { ApiResponse } from './api';
import { api } from './api';
import type { MemberTier } from './member-benefits';

export type MemberSummary = {
  id: string;
  name: string;
  phone: string;
  enabled?: boolean;
  avatarUrl?: string | null;
};
export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'COMPLETED' | 'CANCELED' | 'REFUNDED';
export type BenefitSnapshot = {
  pricingMode?: 'PROGRESSIVE' | 'FIXED';
  growthBase?: string;
  segments?: {
    tier: MemberTier;
    tierName: string;
    discountBps: number;
    originalAmount: string;
    payableAmount: string;
  }[];
  tier: MemberTier;
  tierName: string;
  tierSource: string;
  discountBps: number;
  policyVersion: number;
  pointsPerYuan: number;
  source: 'MEMBER' | 'NONE';
};
export type OrderItem = {
  id?: string;
  productId: string;
  productName: string | null;
  productCode: string | null;
  quantity: number;
  unitPrice: string;
  subtotal: string;
  product?: { name: string; code: string; imageUrl?: string | null };
};
export type Order = {
  shippedAt?: string | null;
  receivedAt?: string | null;
  shippedByName?: string | null;
  receivedByName?: string | null;
  refund?: { id: string; status: string; amount: string } | null;
  seckillSnapshot: SeckillSnapshot | null;
  expiresAt: string | null;
  couponSnapshot: CouponSnapshot | null;
  id: string;
  orderNo: string;
  orderedAt: string;
  status: OrderStatus;
  source: 'LEGACY' | 'CSV_IMPORT' | 'BACKOFFICE';
  store: { id: string; name: string; region: { name: string } };
  member: MemberSummary | null;
  originalAmount: string;
  discountAmount: string;
  payableAmount: string;
  paidAmount: string;
  benefitSnapshot: BenefitSnapshot | null;
  items: OrderItem[];
};
export type OrderInput = {
  benefitMode?: 'MEMBER' | 'NONE' | 'COUPON' | 'SECKILL';
  activityId?: string;
  couponId?: string;
  storeId: string;
  memberId: string;
  items: { productId: string; quantity: number }[];
};
export type Quote = {
  seckillSnapshot: SeckillSnapshot | null;
  couponSnapshot: CouponSnapshot | null;
  quoteHash: string;
  storeId: string;
  storeName: string;
  memberId: string;
  memberName: string;
  originalAmount: string;
  discountAmount: string;
  payableAmount: string;
  benefitSnapshot: BenefitSnapshot;
  items: OrderItem[];
};
export type CouponSnapshot = {
  couponId: string;
  templateId: string;
  name: string;
  minimumSpend: string;
  discountAmount: string;
  startsAt: string;
  endsAt: string;
};
export type SeckillSnapshot = {
  activityId: string;
  name: string;
  price: string;
  holdMinutes: number;
};
export const statusLabels: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '待支付',
  PAID: '已支付',
  COMPLETED: '已完成',
  CANCELED: '已取消',
  REFUNDED: '已退款',
};
export const sourceLabels: Record<Order['source'], string> = {
  LEGACY: '历史录入',
  CSV_IMPORT: 'CSV导入',
  BACKOFFICE: '会员下单',
};
export const money = (value: string) => '¥' + Number(value).toFixed(2);
export const quoteOrder = async (input: OrderInput) =>
  (await api.post<ApiResponse<Quote>>('/orders/quote', input)).data.data;
export const createOrder = async (input: OrderInput, quoteHash: string, requestId: string) =>
  (await api.post<ApiResponse<Order>>('/orders', { ...input, quoteHash, requestId })).data.data;

// 历史退款缺少渠道记录时返回未知，不从原实付编造退款金额。
export const refundedAmount = (order: Order): string | null =>
  order.refund?.status === 'SUCCEEDED'
    ? order.refund.amount
    : order.status === 'REFUNDED'
      ? null
      : '0.00';
