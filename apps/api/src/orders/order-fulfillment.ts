import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { AuthUser } from '../common/api';
import type { DataScopeService } from '../auth/auth';

// 两次明确的模拟操作，复用订单行锁与原订单状态，不修改支付、权益或库存。
export async function fulfillOrder(
  db: PrismaClient,
  scope: DataScopeService,
  user: AuthUser,
  id: string,
  step: 'ship' | 'receive',
) {
  if (!user.permissions.includes('order:view') || !user.permissions.includes('order:fulfill'))
    throw new ForbiddenException('没有订单履约权限');
  return db.$transaction(async (tx) => {
    const visible = await tx.order.findFirst({
      where: { AND: [{ id, deletedAt: null }, scope.orderWhere(user)] },
      select: { id: true },
    });
    if (!visible) throw new NotFoundException('订单不存在或不在你的数据范围内');
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({
      where: { id },
      include: { payment: true, refund: true },
    });
    if (order.source !== 'BACKOFFICE' || order.deletedAt)
      throw new ConflictException('历史导入订单不能补模拟履约');
    if (step === 'receive' && order.receivedAt && order.status === 'COMPLETED') return order;
    if (step === 'ship' && order.shippedAt && ['PAID', 'COMPLETED'].includes(order.status))
      return order;
    if (order.status !== 'PAID' || order.payment?.status !== 'SUCCEEDED')
      throw new ConflictException('仅成功支付且未退款的订单可履约');
    if (order.refund && order.refund.status !== 'FAILED')
      throw new ConflictException('退款正在处理或已成功，不能履约');
    if (step === 'receive' && !order.shippedAt)
      throw new ConflictException('请先模拟发货，再确认收货');
    const now = new Date();
    const result = await tx.order.update({
      where: { id },
      data:
        step === 'ship'
          ? { shippedAt: now, shippedById: user.id, shippedByName: user.name }
          : {
              status: 'COMPLETED',
              receivedAt: now,
              receivedById: user.id,
              receivedByName: user.name,
            },
    });
    await tx.operationLog.create({
      data: {
        userId: user.id,
        module: '订单履约',
        action: step === 'ship' ? '模拟发货' : '模拟确认收货',
        method: 'POST',
        path: `/orders/${id}/${step}`,
        createdAt: now,
      },
    });
    return result;
  });
}
