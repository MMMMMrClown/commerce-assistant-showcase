// 只读投影：不暴露成本，不根据PAID猜测是否已发货。
export function inventoryView(row: Record<string, unknown>) {
  const initialized = typeof row.stockOnHand === 'number';
  const onHand = initialized ? (row.stockOnHand as number) : null;
  const reserved = typeof row.stockReserved === 'number' ? row.stockReserved : 0;
  const warning = typeof row.stockWarning === 'number' ? row.stockWarning : 0;
  const available = onHand === null ? null : onHand - reserved;
  return {
    stockInitialized: initialized,
    stockOnHand: onHand,
    stockReserved: reserved,
    stockAvailable: available,
    stockWarning: warning,
    stockLow: available === null ? null : available <= warning,
  };
}

export function fulfillmentView(order: {
  status: string;
  source: string;
  shippedAt?: Date | null;
  receivedAt?: Date | null;
}) {
  const stage =
    order.source !== 'BACKOFFICE'
      ? 'NOT_APPLICABLE'
      : order.status === 'PAID'
        ? order.shippedAt
          ? 'AWAITING_RECEIPT'
          : 'AWAITING_SHIPMENT'
        : order.status === 'COMPLETED'
          ? order.receivedAt
            ? 'RECEIVED'
            : 'HISTORICAL_COMPLETED'
          : 'NOT_APPLICABLE';
  return {
    fulfillmentStage: stage,
    shippedAt: order.shippedAt ?? null,
    receivedAt: order.receivedAt ?? null,
    fulfillmentDefinition:
      '后台模拟履约；历史完成单缺失记录不能补造发货收货。发货后不支持新售后退款。',
  };
}
