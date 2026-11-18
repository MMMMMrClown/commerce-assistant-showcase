// 【兼容历史快照】只转换已知演示名称的展示，不修改历史快照、商品ID或任何金额。
const legacyLabels: Record<string, string> = {
  冬天的第一杯奶茶: '冬日限量特惠',
  晴天拿铁: '便携保温杯',
  美式咖啡: '轻便购物袋',
  抹茶拿铁: '编织充电线',
  黄油可颂: '全麦饼干',
  蓝莓芝士蛋糕: '每日坚果礼盒',
  晴芽会员: '普通会员',
  初啡会员: '优享会员',
  醇香会员: '银卡会员',
};
export function retailLabel(name: string) {
  return legacyLabels[name] ?? name;
}
