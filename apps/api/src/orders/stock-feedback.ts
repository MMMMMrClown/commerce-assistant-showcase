import { ConflictException } from '@nestjs/common';
type StockProduct = {
  id: string;
  name: string;
  enabled: boolean;
  deletedAt: Date | null;
  stockOnHand: number | null;
  stockReserved: number;
};
// 【购买资格反馈】报价与事务内占用共用判断；仅返回本次商品、需求及可售信息。
export function assertStockAvailable(
  product: StockProduct,
  quantity: number,
): asserts product is StockProduct & { stockOnHand: number } {
  const context = { productId: product.id, productName: product.name, requiredQuantity: quantity };
  if (!product.enabled || product.deletedAt)
    throw new ConflictException({
      code: 'PRODUCT_UNAVAILABLE',
      message: '商品“' + product.name + '”已下架或移入回收站，请重新选择商品',
      details: [{ ...context, reason: 'UNAVAILABLE', nextAction: 'SELECT_PRODUCT' }],
    });
  if (product.stockOnHand === null)
    throw new ConflictException({
      code: 'STOCK_NOT_INITIALIZED',
      message: '商品“' + product.name + '”尚未初始化库存，请先在商品管理中录入库存',
      details: [
        {
          ...context,
          availableQuantity: null,
          reason: 'NOT_INITIALIZED',
          nextAction: 'INITIALIZE_STOCK',
        },
      ],
    });
  const available = product.stockOnHand - product.stockReserved;
  if (available < quantity)
    throw new ConflictException({
      code: 'STOCK_INSUFFICIENT',
      message:
        '商品“' +
        product.name +
        '”可售库存为' +
        available +
        '件，本次需要' +
        quantity +
        '件，请减少数量或调整库存后重新报价',
      details: [
        { ...context, availableQuantity: available, reason: 'INSUFFICIENT', nextAction: 'REQUOTE' },
      ],
    });
}
