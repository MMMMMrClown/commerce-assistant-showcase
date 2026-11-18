import { OrderStatus, Prisma } from '@prisma/client';
import { isISO8601 } from 'class-validator';

export type ImportRow = {
  orderNo: string;
  storeCode: string;
  orderedAt: string;
  status: string;
  productCode: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  paidAmount: string;
};
export type ValidImportRow = ImportRow & {
  storeId: string;
  productId: string;
  parsedStatus: OrderStatus;
  parsedQuantity: number;
  parsedPrice: number;
  parsedDiscount: number;
  parsedPaid: number;
};
type Entry = { value: ValidImportRow; rowNo: number; rawData: ImportRow };
const money = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const maxAmount = new Prisma.Decimal('9999999999.99');

// CSV一单多行：订单级字段必须一致，不能悄悄采用第一行的门店、状态或实付。
export function importOrderErrors(entries: Entry[]) {
  const errors: { rowNo: number; field: string; message: string; rawData: ImportRow }[] = [];
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.value.orderNo) || [];
    group.push(entry);
    groups.set(entry.value.orderNo, group);
  }
  for (const group of groups.values()) {
    const first = group[0].value;
    const add = (entry: Entry, field: string, message: string) =>
      errors.push({ rowNo: entry.rowNo, field, message, rawData: entry.rawData });
    let malformed = false;
    for (const entry of group) {
      const row = entry.value;
      if (
        !isISO8601(row.orderedAt.replace(' ', 'T'), { strict: true }) ||
        !Number.isFinite(new Date(row.orderedAt).getTime())
      ) {
        malformed = true;
        add(entry, 'orderedAt', '下单时间必须为真实日期和有效时间');
      }
      if (
        !/^\d+$/.test(row.quantity) ||
        !Number.isInteger(row.parsedQuantity) ||
        row.parsedQuantity < 1 ||
        row.parsedQuantity > 2147483647
      ) {
        malformed = true;
        add(entry, 'quantity', '数量须为1至2147483647之间的整数');
      }
      if (![row.unitPrice, row.discountAmount || '0', row.paidAmount].every((v) => money.test(v))) {
        malformed = true;
        add(entry, 'amount', '金额须为不超过9999999999.99的非负数，最多两位小数');
      }
      if (
        row.storeId !== first.storeId ||
        row.parsedStatus !== first.parsedStatus ||
        new Date(row.orderedAt).getTime() !== new Date(first.orderedAt).getTime() ||
        row.parsedDiscount !== first.parsedDiscount ||
        row.parsedPaid !== first.parsedPaid
      )
        add(entry, 'orderNo', '同一订单号的门店、下单时间、状态、整单优惠和实付必须一致');
    }
    if (malformed) continue;
    const original = group.reduce(
      (sum, entry) =>
        sum.plus(new Prisma.Decimal(entry.value.unitPrice).mul(entry.value.parsedQuantity)),
      new Prisma.Decimal(0),
    );
    const discount = new Prisma.Decimal(first.discountAmount || '0');
    const paid = new Prisma.Decimal(first.paidAmount);
    for (const entry of group) {
      if (original.gt(maxAmount))
        add(entry, 'amount', '订单总金额超出9999999999.99，请核对商品数量和单价');
      else if (discount.gt(original)) add(entry, 'discountAmount', '整单优惠不能超过订单商品总额');
      else if (first.parsedStatus === 'COMPLETED' && !paid.eq(original.minus(discount)))
        add(entry, 'paidAmount', '已完成订单实付须等于商品总额减去整单优惠');
      else if (first.parsedStatus === 'CANCELED' && !paid.isZero())
        add(entry, 'paidAmount', '已取消订单实付须为0，不将退款流水伪装为取消订单导入');
    }
  }
  return errors;
}
