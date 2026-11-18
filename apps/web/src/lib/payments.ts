export const paymentStatusLabels: Record<string, string> = {
  PENDING: '处理中',
  SUCCEEDED: '成功',
  FAILED: '失败',
  CLOSED: '已关闭',
};
export type PaymentRecordRow = {
  id: string;
  orderId: string;
  amount: string;
  status: string;
  attempt: number;
  channel?: string;
  payment?: { channel: string };
  paymentId?: string;
  reason?: string;
  actorId: string;
  actorName: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt?: string | null;
  refundedAt?: string | null;
  order: {
    id: string;
    orderNo: string;
    member: { name: string; avatarUrl?: string | null } | null;
    store: { name: string };
  };
  refund?: { id: string; status: string } | null;
};
export type PaymentEventRow = {
  id: string;
  kind: string;
  attempt: number;
  outcome: string;
  amount: string;
  createdAt: string;
};
