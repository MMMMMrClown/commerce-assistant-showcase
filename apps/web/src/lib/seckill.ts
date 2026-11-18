export type SeckillActivity = {
  id: string;
  name: string;
  productId: string;
  price: string;
  stock: number;
  remainingStock: number;
  startsAt: string;
  endsAt: string;
  holdMinutes: number;
  enabled: boolean;
  product: { name: string; imageUrl?: string | null; price: string; enabled: boolean };
};

// 【展示状态】仅用于按钮和提示；后端报价、创建时还会独立检查实时条件。
export function seckillState(activity: SeckillActivity, now = Date.now()) {
  if (!activity.enabled) return '已停用';
  if (new Date(activity.startsAt).getTime() > now) return '未开始';
  if (new Date(activity.endsAt).getTime() <= now) return '已结束';
  if (activity.remainingStock <= 0) return '已抢完';
  return '进行中';
}
