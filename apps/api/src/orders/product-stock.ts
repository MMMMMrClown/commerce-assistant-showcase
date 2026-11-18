import { createHash } from 'node:crypto';
import { assertStockAvailable } from './stock-feedback';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
type Tx = Prisma.TransactionClient;
// 【库存互斥】余额不修改商品键；此锁兼容订单明细外键的KEY SHARE，避免建单后的锁升级死锁。
// 多商品仍依ID顺序加锁，余额写入彼此互斥。
async function locked(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR NO KEY UPDATE`;
  return tx.product.findUniqueOrThrow({ where: { id } });
}
async function movement(
  tx: Tx,
  before: Awaited<ReturnType<typeof locked>>,
  kind: string,
  onHand: number,
  reserved: number,
  actorId: string,
  reason: string,
  orderId?: string,
  requestId?: string,
  requestHash?: string,
) {
  if (onHand < reserved || reserved < 0 || onHand > 1000000000)
    throw new ConflictException({
      code: 'STOCK_BALANCE_INVALID',
      message: '商品“' + before.name + '”库存余额异常，操作未完成，请核对库存记录后重试',
      details: [
        { productId: before.id, productName: before.name, nextAction: 'CHECK_STOCK_MOVEMENTS' },
      ],
    });
  await tx.product.update({
    where: { id: before.id },
    data: { stockOnHand: onHand, stockReserved: reserved, stockVersion: { increment: 1 } },
  });
  await tx.productStockMovement.create({
    data: {
      productId: before.id,
      kind,
      actorId,
      reason,
      orderId,
      requestId,
      requestHash,
      beforeOnHand: before.stockOnHand,
      afterOnHand: onHand,
      beforeReserved: before.stockReserved,
      afterReserved: reserved,
    },
  });
}
export async function adjustStock(
  tx: Tx,
  productId: string,
  quantity: number,
  version: number,
  actorId: string,
  reason: string,
  requestId: string,
  warning: number,
) {
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ productId, quantity, version, actorId, reason, warning }))
    .digest('hex');
  const p = await locked(tx, productId);
  const previous = await tx.productStockMovement.findUnique({ where: { requestId } });
  if (previous) {
    if (
      previous.productId !== productId ||
      previous.actorId !== actorId ||
      previous.reason !== reason ||
      previous.afterOnHand !== quantity ||
      previous.requestHash !== requestHash
    )
      throw new ConflictException({
        code: 'STOCK_REQUEST_REUSED',
        message: '库存提交标识已用于另一份调整，请重新打开商品“' + p.name + '”的库存操作',
        details: [{ productId: p.id, nextAction: 'REOPEN_STOCK_EDITOR' }],
      });
    return previous;
  }
  if (p.deletedAt)
    throw new ConflictException({
      code: 'PRODUCT_UNAVAILABLE',
      message: '商品“' + p.name + '”已移入回收站，请先恢复商品后再调整库存',
      details: [{ productId: p.id, nextAction: 'RESTORE_PRODUCT' }],
    });
  if (p.stockVersion !== version)
    throw new ConflictException({
      code: 'STOCK_CHANGED',
      message: '商品“' + p.name + '”的库存已变化，请刷新后核对数量再提交',
      details: [{ productId: p.id, nextAction: 'RELOAD_STOCK' }],
    });
  // 【调整占用下限】先说明占用限制，保持原来的库存约束与事务回滚行为。
  if (quantity < p.stockReserved)
    throw new ConflictException({
      code: 'STOCK_RESERVED_CONFLICT',
      message:
        '商品“' +
        p.name +
        '”还有' +
        p.stockReserved +
        '件被订单占用，现存库存不能调整为' +
        quantity +
        '件，请先处理占用订单或提高现存量',
      details: [
        {
          productId: p.id,
          productName: p.name,
          reservedQuantity: p.stockReserved,
          requestedOnHand: quantity,
          nextAction: 'CHECK_ACTIVE_ORDERS',
        },
      ],
    });
  await movement(
    tx,
    p,
    p.stockOnHand === null ? 'INITIALIZE' : 'ADJUST',
    quantity,
    p.stockReserved,
    actorId,
    reason,
    undefined,
    requestId,
    requestHash,
  );
  await tx.product.update({ where: { id: productId }, data: { stockWarning: warning } });
  return tx.product.findUniqueOrThrow({ where: { id: productId } });
}
export async function reserveStock(
  tx: Tx,
  orderId: string,
  items: { productId: string; quantity: number }[],
  actorId: string,
) {
  for (const item of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const p = await locked(tx, item.productId);
    assertStockAvailable(p, item.quantity);
    await tx.productStockHold.create({
      data: { orderId, productId: item.productId, quantity: item.quantity },
    });
    await movement(
      tx,
      p,
      'RESERVE',
      p.stockOnHand,
      p.stockReserved + item.quantity,
      actorId,
      '创建订单占用',
      orderId,
    );
  }
}
export async function transitionStock(
  tx: Tx,
  orderId: string,
  action: 'RELEASE' | 'CONSUME' | 'REFUND',
  actorId: string,
) {
  const holds = await tx.productStockHold.findMany({
    where: { orderId },
    orderBy: { productId: 'asc' },
  });
  for (const hold of holds) {
    const p = await locked(tx, hold.productId);
    const from = action === 'REFUND' ? 'CONSUMED' : 'RESERVED';
    const status =
      action === 'REFUND' ? 'REFUNDED' : action === 'RELEASE' ? 'RELEASED' : 'CONSUMED';
    const changed = await tx.productStockHold.updateMany({
      where: { id: hold.id, status: from },
      data: { status },
    });
    if (!changed.count) continue;
    if (p.stockOnHand === null) throw new ConflictException('已占用商品库存异常');
    const onHand =
      p.stockOnHand +
      (action === 'REFUND' ? hold.quantity : action === 'CONSUME' ? -hold.quantity : 0);
    const reserved = p.stockReserved - (action === 'REFUND' ? 0 : hold.quantity);
    await movement(
      tx,
      p,
      action,
      onHand,
      reserved,
      actorId,
      action === 'REFUND'
        ? '整单退款成功回补模拟库存'
        : action === 'CONSUME'
          ? '付款成功扣减'
          : '订单取消或到期释放',
      orderId,
    );
  }
}
