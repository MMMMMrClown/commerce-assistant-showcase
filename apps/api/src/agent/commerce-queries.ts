import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { DataScopeService } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { commerceDateRange } from '../common/commerce-query';
import type { PrismaService } from '../prisma/prisma.service';
import { BusinessOperations } from './business-operations';
import { summaryPeriod, summaryPeriodSchema } from './summary-period';
import { maskPhone, type MemberState } from './member-tools';

const id = z.string().trim().min(1).max(100);
const page = z.number().int().min(1).max(100).default(1);
const dates = { startDate: z.iso.date().optional(), endDate: z.iso.date().optional() };
export const COMMERCE_QUERIES = [
  {
    key: 'query_product_sales',
    label: '指定商品销量与订单状态统计',
    permissions: ['product:view', 'order:view'],
    allScope: false,
    description:
      '先查真实商品ID，再按days或起止日期汇总指定商品全量交易件数，不受热销榜前6名限制。返回已支付及已完成的净成交件数、已完成件数和各状态订单数/件数，不含成本或虚构商品实付金额；支持门店ID且不扩大账号范围。',
    schema: summaryPeriodSchema.extend({ productId: id, storeId: id.optional() }).strict(),
  },
  {
    key: 'list_payment_records',
    label: '支付退款记录检索',
    permissions: ['order:view'],
    allScope: false,
    description:
      '按支付或退款记录种类、业务单号/记录编号、状态、门店关键词、订单ID和记录创建日期查全量分页记录。日期是记录创建时间，不是订单日期；只是查询，不模拟支付结果。',
    schema: z
      .object({
        kind: z.enum(['payments', 'refunds']).default('payments'),
        page,
        keyword: z.string().max(100).optional(),
        storeKeyword: z.string().max(100).optional(),
        orderId: id.optional(),
        status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CLOSED']).optional(),
        channel: z.literal('MOCK').optional(),
        ...dates,
      })
      .strict(),
  },
  {
    key: 'get_payment_record',
    label: '支付退款记录与事件详情',
    permissions: ['order:view'],
    allScope: false,
    description:
      '使用真实记录ID和payments/refunds种类查询单笔记录及分页事件，继承订单数据范围，不改变结果。',
    schema: z
      .object({ kind: z.enum(['payments', 'refunds']), recordId: id, eventPage: page })
      .strict(),
  },
  {
    key: 'list_coupon_templates',
    label: '优惠券模板目录',
    permissions: ['member:view', 'member:coupon-issue'],
    allScope: true,
    description:
      '分页查询未停发优惠券模板真实ID、版本、门槛、优惠和有效期；已发历史券请查发放记录，新建模板和发券仍分别确认。',
    schema: z.object({ keyword: z.string().max(100).default(''), page }).strict(),
  },
  {
    key: 'list_coupon_records',
    label: '优惠券发放记录检索',
    permissions: ['member:view'],
    allScope: true,
    description:
      '按模板ID、状态、发放日期、关键词查询分页发券记录，包含来源和脱敏会员，不把模板创建当已发券，名单记录不等于已确认会员身份。',
    schema: z
      .object({
        page,
        keyword: z.string().max(100).optional(),
        templateId: id.optional(),
        status: z
          .enum(['AVAILABLE', 'RESERVED', 'USED', 'VOID', 'EXPIRED', 'NOT_STARTED'])
          .optional(),
        ...dates,
      })
      .strict(),
  },
  {
    key: 'list_marketing_programs',
    label: '新人礼包与生日关怀配置查询',
    permissions: ['member:view'],
    allScope: true,
    description: '查询原新人礼包/生日关怀玩法的真实启停、模板和版本，只读，不配置或执行发券扫描。',
    schema: z.object({}).strict(),
  },
  {
    key: 'list_marketing_grants',
    label: '新人礼包与生日关怀发放记录',
    permissions: ['member:view'],
    allScope: true,
    description:
      '分页查询WELCOME新人或BIRTHDAY生日玩法资格/发放状态及失败原因；按memberId查询须先选定会员。资格入队不等于发券成功，不重试执行。',
    schema: z
      .object({
        kind: z.enum(['WELCOME', 'BIRTHDAY']),
        page,
        status: z.enum(['PENDING', 'FAILED', 'SUCCEEDED']).optional(),
        memberId: id.optional(),
      })
      .strict(),
  },
] as const;

type Row = Record<string, unknown>;
const row = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const pick = (value: unknown, fields: string[]) =>
  Object.fromEntries(fields.map((key) => [key, row(value)[key]]));
const template = (value: unknown) =>
  pick(value, [
    'id',
    'name',
    'version',
    'minimumSpend',
    'discountAmount',
    'startsAt',
    'endsAt',
    'deletedAt',
  ]);
const member = (value: unknown) => ({
  ...pick(value, ['id', 'name', 'enabled']),
  ...(typeof row(value).phone === 'string'
    ? { maskedPhone: maskPhone(row(value).phone as string) }
    : {}),
});
function payment(value: unknown) {
  return {
    ...pick(value, [
      'id',
      'orderId',
      'status',
      'amount',
      'channel',
      'attempt',
      'reason',
      'createdAt',
      'updatedAt',
      'paidAt',
      'refundedAt',
      'actorName',
    ]),
    order: {
      ...pick(row(value).order, ['id', 'orderNo']),
      store: pick(row(row(value).order).store, ['name']),
    },
    channel: row(value).channel ?? row(row(value).payment).channel,
    refund: pick(row(value).refund, ['id', 'status']),
  };
}

export async function queryProductSales(db: PrismaService, user: AuthUser, input: unknown) {
  if (!['product:view', 'order:view'].every((p) => user.permissions.includes(p)))
    throw new ForbiddenException('需要商品和订单查看权限');
  const args = COMMERCE_QUERIES[0].schema.parse(input);
  const { productId, storeId, ...window } = args;
  const period = summaryPeriod(window);
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, code: true },
  });
  if (!product) throw new NotFoundException('商品不存在');
  const order: Prisma.OrderWhereInput = {
    AND: [
      { deletedAt: null, orderedAt: { gte: period.start, lte: period.end } },
      new DataScopeService().orderWhere(user),
      ...(storeId ? [{ storeId }] : []),
    ],
  };
  const statuses = Object.values(OrderStatus);
  const breakdown = await db.$transaction(
    async (tx) => {
      const counts = await tx.order.groupBy({
        by: ['status'],
        where: { AND: [order, { items: { some: { productId } } }] },
        _count: { _all: true },
      });
      return Promise.all(
        statuses.map(async (status) => {
          const quantity = await tx.orderItem.aggregate({
            where: { productId, order: { AND: [order, { status }] } },
            _sum: { quantity: true },
          });
          return {
            status,
            orderCount: counts.find((group) => group.status === status)?._count._all || 0,
            quantity: quantity._sum.quantity || 0,
          };
        }),
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const quantities = (status: OrderStatus) => breakdown.find((item) => item.status === status)!;
  return {
    ok: true,
    product,
    period: period.q,
    scope: '当前账号有权查看的门店范围',
    netPaidQuantity: quantities('PAID').quantity + quantities('COMPLETED').quantity,
    netPaidOrderCount: quantities('PAID').orderCount + quantities('COMPLETED').orderCount,
    completedQuantity: quantities('COMPLETED').quantity,
    statusBreakdown: breakdown,
    definition:
      '按上海时区订单创建日期全量汇总指定商品行quantity，含历史导入；净成交件数=PAID+COMPLETED，不含待支付、取消、已退款。已完成件数单列，与销售看板COMPLETED口径一致。不是排行榜，不受前6名限制；金额未按商品分摊，不能据整单实付推算该商品实付或利润。',
  };
}

export async function queryCommerceRecords(
  config: ConfigService,
  user: AuthUser,
  credential: string,
  key: string,
  input: unknown,
  state: MemberState,
) {
  const definition = COMMERCE_QUERIES.find((d) => d.key === key && d.key !== 'query_product_sales');
  if (!definition) throw new BadRequestException('未接入的查询');
  if (
    !definition.permissions.every((p) => user.permissions.includes(p)) ||
    (definition.allScope && !user.roles.some((r) => r.dataScope === 'ALL'))
  )
    throw new ForbiddenException('没有对应业务查询权限或数据范围');
  const args = definition.schema.parse(input) as Row;
  commerceDateRange(args.startDate as string | undefined, args.endDate as string | undefined);
  if (args.memberId && args.memberId !== state.selectedMemberId)
    throw new BadRequestException('请先搜索并选择会员');
  const query = new URLSearchParams(
    Object.entries(args)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  const bridge = new BusinessOperations(config);
  if (key === 'list_coupon_templates') {
    const all = (await bridge.request(credential, 'coupons/templates')) as Row[];
    const keyword = String(args.keyword).toLowerCase();
    const filtered = all.filter((item) =>
      [item.id, item.name].some((v) => String(v).toLowerCase().includes(keyword)),
    );
    return {
      ok: true,
      total: filtered.length,
      page: args.page,
      pageSize: 10,
      items: filtered.slice((Number(args.page) - 1) * 10, Number(args.page) * 10).map(template),
    };
  }
  if (key === 'list_marketing_programs') {
    const all = (await bridge.request(credential, 'marketing/programs')) as Row[];
    return {
      ok: true,
      items: all.map((item) => ({
        ...pick(item, ['kind', 'enabled', 'version', 'templateId', 'updatedAt']),
        template: template(item.template),
      })),
    };
  }
  const path =
    key === 'list_payment_records'
      ? 'payment-records?' + query.toString()
      : key === 'get_payment_record'
        ? 'payment-records/' +
          encodeURIComponent(String(args.recordId)) +
          '?kind=' +
          String(args.kind) +
          '&eventPage=' +
          String(args.eventPage)
        : key === 'list_coupon_records'
          ? 'coupons/records?' + query.toString()
          : 'marketing/programs/' + String(args.kind) + '/grants?' + query.toString();
  const data = (await bridge.request(credential, path)) as Row;
  if (key === 'get_payment_record') {
    const events = row(data.events);
    return {
      ok: true,
      record: payment(data.record),
      events: {
        ...pick(events, ['total', 'page', 'pageSize']),
        items: ((events.items || []) as Row[]).map((item) =>
          pick(item, ['id', 'kind', 'outcome', 'amount', 'attempt', 'createdAt']),
        ),
      },
    };
  }
  return {
    ok: true,
    ...pick(data, ['total', 'page', 'pageSize']),
    items: ((data.items || []) as Row[]).map((item) =>
      key === 'list_payment_records'
        ? payment(item)
        : key === 'list_coupon_records'
          ? {
              ...pick(item, ['id', 'status', 'displayStatus', 'source', 'createdAt', 'batchId']),
              member: member(item.member),
              template: template(item.template),
              issuedBy: pick(item.issuedBy, ['name']),
            }
          : {
              ...pick(item, [
                'id',
                'kind',
                'status',
                'period',
                'memberId',
                'couponId',
                'templateId',
                'attempts',
                'lastError',
                'createdAt',
                'updatedAt',
              ]),
              member: member(item.member),
            },
    ),
    definition:
      key === 'list_payment_records'
        ? '按记录创建日期筛选，返回分页明细，当前页金额/条数不能冒充全量汇总；继承订单门店范围。'
        : '分页记录，当前页不是全量统计；资格或模板存在不代表发券成功。',
  };
}
