import type { AuthUser } from '../common/api';
import { COMMERCE_QUERIES } from './commerce-queries';
import { BUSINESS_OPERATIONS, BUSINESS_QUERIES } from './business-operations';
import { CATALOG_OPERATIONS, CATALOG_LOOKUPS } from './catalog-operations';

type Capability = {
  key: string;
  label: string;
  description: string;
  permissions: string[];
  allScope?: boolean;
  requiresApproval?: boolean;
};
// 【能力真相】仅登记已经接入的工具；计划功能不能出现在运行时宣传中。
export const CAPABILITIES: readonly Capability[] = [
  ...COMMERCE_QUERIES.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    permissions: [...d.permissions],
    allScope: d.allScope,
  })),
  {
    key: 'select_batch_members',
    label: '选择批量会员对象',
    description: '按明确名单或人数随机选择已有会员，固定集合以复用于多种业务',
    permissions: ['member:view'],
    allScope: true,
  },
  {
    key: 'select_batch_products',
    label: '选择批量商品对象',
    description: '按明确名称、编号或ID固定商品集合，供修改价格、库存、上下架等业务复用',
    permissions: ['product:view'],
    allScope: true,
  },
  {
    key: 'prepare_order_fulfillment',
    label: '模拟订单履约',
    description: '查询订单后准备模拟发货或确认收货卡，不涉及真实物流',
    permissions: ['order:view', 'order:fulfill'],
    requiresApproval: true,
  },
  {
    key: 'prepare_generated_members',
    label: '批量生成模拟会员',
    description: '按人数生成标明模拟资料的会员预览，确认后创建；不冒充真实联系方式',
    permissions: ['member:view', 'member:create'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_batch_operations',
    label: '批量业务操作',
    description:
      '对明确对象批量执行已授权会员、商品、库存、优惠券、活动、订单及管理业务，逐项预览，一次确认，逐项记录结果',
    permissions: [],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_product_stock',
    label: '调整商品库存',
    description: '设置现存量或增加/减少库存，冻结目标、保留占用下限和流水，预览后确认',
    permissions: ['product:view', 'product:edit'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'propose_seckill_activity',
    label: '分析并拟定秒杀方案',
    description: '查询在售商品与经营数据，生成可修改、待人工确认的建议活动',
    permissions: ['dashboard:view', 'product:view', 'seckill:manage'],
    requiresApproval: true,
  },
  {
    key: 'prepare_operation_plan',
    label: '跨业务执行计划',
    description: '拆解顺序步骤，每步独立确认，保留完成结果并恢复剩余任务',
    permissions: ['dashboard:view'],
    requiresApproval: true,
  },
  {
    key: 'search_orders',
    label: '订单检索',
    description: '按业务单号、商品名称/编号、状态、来源、日期或门店查找授权订单及商品行数量',
    permissions: ['order:view'],
  },
  {
    key: 'compare_business_periods',
    label: '经营周期对比',
    description: '同口径、等长周期对比并据数据提出行动建议，各领域按权限查询',
    permissions: ['dashboard:view'],
  },
  ...BUSINESS_QUERIES.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.label,
    permissions: [...d.permissions],
    allScope: true,
  })),
  ...BUSINESS_OPERATIONS.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    permissions: [...d.permissions],
    allScope: true,
    requiresApproval: true,
  })),
  {
    key: 'prepare_campaign_plan',
    label: '满减活动与发券任务',
    description: '集中补问，分步预览和确认，可恢复未完成步骤',
    permissions: ['member:view', 'member:coupon-issue'],
    allScope: true,
    requiresApproval: true,
  },
  ...[
    { key: 'prepare_coupon_template_update', label: '修改券模板' },
    { key: 'prepare_coupon_template_disable', label: '停止券模板发放' },
    { key: 'prepare_coupon_void', label: '作废会员券' },
  ].map((d) => ({
    ...d,
    description: '查看规则和影响后单独确认',
    permissions: ['member:view', 'member:coupon-issue'],
    allScope: true,
    requiresApproval: true,
  })),
  ...CATALOG_LOOKUPS.map((d) => ({
    key: d.key,
    label: d.label,
    description: '查询经过裁剪的真实管理目录',
    permissions: [d.permission],
    allScope: true,
  })),
  {
    key: 'list_regions',
    label: '区域查询',
    description: '查询真实区域编号与状态',
    permissions: ['region:view'],
  },
  ...CATALOG_OPERATIONS.map((d) => ({
    key: d.key,
    label: d.label,
    description: '预览字段与差异后人工确认',
    permissions: [d.permission, d.readPermission],
    allScope: true,
    requiresApproval: true,
  })),
  {
    key: 'get_operation_status',
    label: '操作结果核对',
    description: '查询本人操作的等待确认、执行和结果状态',
    permissions: [],
  },
  {
    key: 'list_product_categories',
    label: '商品分类查询',
    description: '查询新增商品所需的真实分类',
    permissions: ['product-category:view'],
  },
  {
    key: 'prepare_product_create',
    label: '新增商品',
    description: '明确编号、名称、分类、售价与成本后确认创建',
    permissions: ['product:view', 'product:create'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_product_rename',
    label: '修改商品名称',
    description: '核对商品名称差异后确认修改',
    permissions: ['product:view', 'product:edit'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_product_edit',
    label: '编辑商品资料与上下架',
    description: '明确修改字段，确认名称、分类、售价、成本或上下架差异后执行',
    permissions: ['product:view', 'product:edit'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_member_edit',
    label: '编辑会员资料与启停',
    description: '选定会员，确认姓名、手机号或启停差异后执行；不改积分和消费额',
    permissions: ['member:view', 'member:edit'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_coupon_template',
    label: '创建满减券模板',
    description: '明确满减规则和有效期，确认后创建，不自动发券',
    permissions: ['member:view', 'member:coupon-issue'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_coupon_issue',
    label: '指定会员发券',
    description: '确认模板和固定会员集合后发放',
    permissions: ['member:view', 'member:coupon-issue'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_seckill_toggle',
    label: '秒杀启停',
    description: '查看影响后确认启用或停用秒杀',
    permissions: ['seckill:manage'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_member_create',
    label: '新增会员',
    description: '提供姓名和手机号，预览并确认新增；重复手机号不覆盖',
    permissions: ['member:view', 'member:create'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_member_rename',
    label: '修改会员姓名',
    description: '选定会员，核对姓名差异后确认修改',
    permissions: ['member:view', 'member:edit'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'get_capabilities',
    label: '使用帮助',
    description: '介绍当前账号可用能力和操作边界',
    permissions: [],
  },
  {
    key: 'query_sales_summary',
    label: '销售概览',
    description: '查询销售、订单量和商品排行',
    permissions: ['dashboard:view'],
  },
  {
    key: 'query_member_statistics',
    label: '会员统计',
    description: '查询会员增长、等级分布与权益',
    permissions: ['member:view'],
    allScope: true,
  },
  {
    key: 'query_campaign_performance',
    label: '活动概览',
    description: '查询营销和秒杀活动效果',
    permissions: ['order:view', 'seckill:view'],
  },
  {
    key: 'query_payment_summary',
    label: '支付退款统计',
    description: '查询模拟支付退款统计',
    permissions: ['order:view'],
  },
  {
    key: 'search_members',
    label: '查找会员',
    description: '精确手机号或姓名候选查询',
    permissions: ['member:view'],
    allScope: true,
  },
  {
    key: 'get_member_profile',
    label: '会员详情',
    description: '查询已选会员档案与权益',
    permissions: ['member:view'],
    allScope: true,
  },
  {
    key: 'list_member_orders',
    label: '会员订单',
    description: '查询已选会员订单，沿用订单数据范围',
    permissions: ['member:view', 'order:view'],
    allScope: true,
  },
  {
    key: 'get_product_stock_movements',
    label: '库存流水查询',
    description: '查询指定真实商品的库存占用、扣减、释放流水，不调整库存',
    permissions: ['product:view'],
  },
  {
    key: 'list_products',
    label: '商品查询',
    description: '查询商品、价格、现存/占用/可售库存及预警，不含成本',
    permissions: ['product:view'],
  },
  {
    key: 'list_stores',
    label: '门店查询',
    description: '查询授权范围的门店',
    permissions: ['store:view'],
  },
  {
    key: 'list_coupons',
    label: '会员卡券',
    description: '查询已选会员卡券',
    permissions: ['member:view'],
    allScope: true,
  },
  {
    key: 'list_seckill',
    label: '秒杀查询',
    description: '查询秒杀活动和独立名额',
    permissions: ['seckill:view'],
  },
  {
    key: 'get_order',
    label: '订单详情',
    description: '查询授权范围订单状态',
    permissions: ['order:view'],
  },
  {
    key: 'get_payment_status',
    label: '支付退款详情',
    description: '查询订单模拟支付退款现态',
    permissions: ['order:view'],
  },
  {
    key: 'search_business_knowledge',
    label: '规则解释',
    description: '检索已审核项目规则并引用来源',
    permissions: [],
  },
  {
    key: 'quote_order',
    label: '创建订单',
    description: '选择会员、商品和门店，实时报价后确认创建待支付订单',
    permissions: ['order:create', 'member:view'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_batch_orders',
    label: '随机会员批量下单',
    description: '明确委托后随机选取最多20位已有会员，固定名单和逐笔报价，确认后创建待支付订单',
    permissions: ['order:create', 'member:view', 'product:view', 'store:view'],
    allScope: true,
    requiresApproval: true,
  },
  {
    key: 'prepare_cancel_order',
    label: '取消订单',
    description: '预览并确认取消待支付后台订单',
    permissions: ['order:view', 'order:cancel'],
    requiresApproval: true,
  },
  {
    key: 'prepare_seckill_activity',
    label: '发布秒杀活动',
    description: '提供商品、名称、价格、名额和起止时间，预览后确认发布',
    permissions: ['seckill:manage', 'product:view'],
    requiresApproval: true,
  },
  {
    key: 'prepare_payment',
    label: '模拟支付',
    description: '确认后发起模拟支付请求，不代表支付成功',
    permissions: ['order:view', 'order:pay'],
    requiresApproval: true,
  },
  {
    key: 'prepare_refund',
    label: '整单模拟退款',
    description: '提供原因并确认退款申请，不代表退款成功',
    permissions: ['order:view', 'order:refund'],
    requiresApproval: true,
  },
];

// 【权限投影】注册表仅控制能力展示与工具可见性，执行端仍独立复核当前权限。
export function availableCapabilities(user: AuthUser, writesEnabled: boolean) {
  if (!user.permissions.includes('dashboard:view')) return [];
  return CAPABILITIES.filter(
    (c) =>
      c.permissions.every((p) => user.permissions.includes(p)) &&
      (!c.allScope || user.roles.some((r) => r.dataScope === 'ALL')),
  ).map((c) => ({ ...c, executionEnabled: !c.requiresApproval || writesEnabled }));
}
