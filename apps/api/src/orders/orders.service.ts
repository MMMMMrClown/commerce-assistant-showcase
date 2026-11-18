import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderSource, OrderStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { assertCouponUsable } from '../coupons/coupon-feedback';
import { assertStockAvailable } from './stock-feedback';
import { reserveStock, transitionStock } from './product-stock';
import { fulfillOrder } from './order-fulfillment';
import { DataScopeService } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { pagination } from '../common/api';
import { commerceDateRange } from '../common/commerce-query';
import { PrismaService } from '../prisma/prisma.service';
import { BenefitMode, CreateOrderDto, ListOrdersDto, QuoteOrderDto } from './order.dto';
import { MemberBenefitsService } from '../member-benefits/member-benefits.service';
import { memberPricing } from '../member-benefits/benefit-rules';

const includeOrder = {
  store: { include: { region: true } },
  member: { select: { id: true, name: true, phone: true, avatarUrl: true } },
  items: { include: { product: true } },
  refund: { select: { id: true, status: true, amount: true } },
} satisfies Prisma.OrderInclude;

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
    private readonly benefits: MemberBenefitsService,
  ) {}

  fulfill(user: AuthUser, id: string, step: 'ship' | 'receive') {
    return fulfillOrder(this.prisma, this.scope, user, id, step);
  }

  // 【营销效果】按订单创建时间与账号数据范围汇总，历史导入单不伪装成营销转化。
  async campaignPerformance(user: AuthUser, start: Date, end: Date) {
    const orders = await this.prisma.order.findMany({
      where: {
        AND: [
          { deletedAt: null, source: 'BACKOFFICE', orderedAt: { gte: start, lte: end } },
          this.scope.orderWhere(user),
        ],
      },
      select: {
        status: true,
        paidAmount: true,
        discountAmount: true,
        couponSnapshot: true,
        seckillSnapshot: true,
        benefitSnapshot: true,
      },
    });
    const groups: Record<
      string,
      { orders: number; effectivePaidOrders: number; revenue: number; discount: number }
    > = {};
    for (const order of orders) {
      const benefit = order.benefitSnapshot as { source?: string } | null;
      const mode = order.seckillSnapshot
        ? '秒杀'
        : order.couponSnapshot
          ? '优惠券'
          : benefit?.source === 'MEMBER'
            ? '会员折扣'
            : '原价';
      const entry = (groups[mode] ||= {
        orders: 0,
        effectivePaidOrders: 0,
        revenue: 0,
        discount: 0,
      });
      entry.orders++;
      if (['PAID', 'COMPLETED'].includes(order.status)) {
        entry.effectivePaidOrders++;
        entry.revenue += Number(order.paidAmount);
        entry.discount += Number(order.discountAmount);
      }
    }
    for (const entry of Object.values(groups)) {
      entry.revenue = Number(entry.revenue.toFixed(2));
      entry.discount = Number(entry.discount.toFixed(2));
    }
    // 【活动明细】活动配置为全平台目录；成交汇总仍受当前账号门店范围限制。
    const activities = await this.prisma.seckillActivity.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        name: true,
        startsAt: true,
        endsAt: true,
        enabled: true,
        createdAt: true,
      },
    });
    return {
      activities: activities.map((a) => ({
        ...a,
        durationHours: (a.endsAt.getTime() - a.startsAt.getTime()) / 3600000,
        status: !a.enabled
          ? '已停用'
          : a.startsAt > new Date()
            ? '未开始'
            : a.endsAt < new Date()
              ? '已结束'
              : '进行中',
      })),
      activityDefinition:
        '按创建时间降序的最近20个活动配置，不限成交窗口；最新创建活动为第一项，当前运行与最新结束可根据起止时间和状态判断，不能混淆。持续时间按配置起止时间计算。',
      groups,
      definition:
        '按优惠类型汇总，已支付/已完成且未退款订单计入有效成交；没有曝光数据，不能计算营销转化率或归因增量。秒杀库存为独立名额。',
    };
  }

  async list(user: AuthUser, query: ListOrdersDto) {
    const p = pagination(query.page, query.pageSize);
    const dateRange = commerceDateRange(query.startDate, query.endDate);
    // AND keeps a client-supplied filter from replacing the employee's data scope.
    const where: Prisma.OrderWhereInput = {
      AND: [
        { deletedAt: null },
        this.scope.orderWhere(user),
        query.keyword ? { orderNo: { contains: query.keyword.trim(), mode: 'insensitive' } } : {},
        query.status ? { status: query.status } : {},
        query.memberId ? { memberId: query.memberId } : {},
        query.source ? { source: query.source } : {},
        query.memberKeyword
          ? {
              member: {
                OR: [
                  { name: { contains: query.memberKeyword.trim(), mode: 'insensitive' } },
                  { phone: { contains: query.memberKeyword.trim() } },
                ],
              },
            }
          : {},
        query.productKeyword
          ? {
              items: {
                some: {
                  OR: [
                    { productName: { contains: query.productKeyword.trim(), mode: 'insensitive' } },
                    { productCode: { contains: query.productKeyword.trim(), mode: 'insensitive' } },
                    {
                      product: {
                        OR: [
                          { name: { contains: query.productKeyword.trim(), mode: 'insensitive' } },
                          { code: { contains: query.productKeyword.trim(), mode: 'insensitive' } },
                        ],
                      },
                    },
                  ],
                },
              },
            }
          : {},
        query.storeKeyword
          ? {
              store: {
                OR: [
                  { name: { contains: query.storeKeyword.trim(), mode: 'insensitive' } },
                  { code: { contains: query.storeKeyword.trim(), mode: 'insensitive' } },
                ],
              },
            }
          : {},
        query.storeId ? { storeId: query.storeId } : {},
        query.startDate || query.endDate
          ? {
              orderedAt: dateRange,
            }
          : {},
      ],
    };
    const countsQuery = this.prisma.order.groupBy({
      by: ['status'],
      orderBy: { status: 'asc' },
      where: {
        AND: (where.AND as Prisma.OrderWhereInput[]).filter((condition) => !condition.status),
      },
      _count: { _all: true },
    });
    const [items, total, grouped] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: includeOrder,
        skip: p.skip,
        take: p.take,
        orderBy: [
          {
            [['orderNo', 'orderedAt', 'status', 'payableAmount', 'paidAmount'].includes(
              query.sortBy || '',
            )
              ? query.sortBy!
              : 'orderedAt']: query.sortDirection === 'asc' ? 'asc' : 'desc',
          },
          { id: 'desc' },
        ],
      }),
      this.prisma.order.count({ where }),
      countsQuery,
    ]);
    return {
      items,
      total,
      page: p.page,
      pageSize: p.pageSize,
      statusCounts: Object.fromEntries<number>([
        ['', grouped.reduce((n, g) => n + g._count._all, 0)] as const,
        ...grouped.map((g) => [g.status, g._count._all] as const),
      ]),
    };
  }

  async detail(user: AuthUser, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scope.orderWhere(user)] },
      include: includeOrder,
    });
    if (!order) throw new NotFoundException('订单不存在或不在你的数据范围内');
    return order;
  }

  private normalize(dto: QuoteOrderDto) {
    const mode = dto.benefitMode ?? BenefitMode.MEMBER;
    if ((mode === BenefitMode.COUPON) !== Boolean(dto.couponId)) {
      throw new BadRequestException('用券时必须选择会员券，满减券不能与会员折扣叠加');
    }
    const items = [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId));
    // 【秒杀输入约束】秒杀订单一次一个商品一件，活动与其他优惠模式互斥。
    if (
      (mode === BenefitMode.SECKILL) !== Boolean(dto.activityId) ||
      (mode === BenefitMode.SECKILL && (items.length !== 1 || items[0].quantity !== 1))
    ) {
      throw new BadRequestException('秒杀必须指定活动、仅限一个商品一件，不能与其他优惠叠加');
    }
    if (new Set(items.map((item) => item.productId)).size !== items.length) {
      throw new BadRequestException('同一商品请合并数量，不要重复添加');
    }
    return {
      storeId: dto.storeId,
      memberId: dto.memberId,
      items,
      benefitMode: dto.benefitMode ?? BenefitMode.MEMBER,
      couponId: dto.couponId ?? null,
      activityId: dto.activityId ?? null,
    };
  }

  private async buildQuote(tx: Prisma.TransactionClient, user: AuthUser, dto: QuoteOrderDto) {
    // 从数据库读取价格；前端只传商品ID和数量，不能自行指定成交金额。
    const input = this.normalize(dto);
    const store = await tx.store.findFirst({
      where: {
        AND: [{ id: input.storeId, enabled: true, deletedAt: null }, this.scope.storeWhere(user)],
      },
    });
    if (!store) throw new BadRequestException('门店不存在、已停用或无权操作');
    const member = await tx.member.findUnique({ where: { id: input.memberId } });
    if (!member?.enabled) throw new BadRequestException('会员不存在或已停用');
    const products = await tx.product.findMany({
      where: {
        id: { in: input.items.map((item) => item.productId) },
        enabled: true,
        deletedAt: null,
      },
      include: { category: true },
    });
    const items = input.items.map((item) => {
      const product = products.find((product) => product.id === item.productId);
      if (!product)
        throw new BadRequestException('所选商品不存在或已下架，请刷新商品列表后重新选择');
      if (!product.category.enabled)
        throw new BadRequestException({
          code: 'PRODUCT_CATEGORY_DISABLED',
          message: '商品“' + product.name + '”所属分类已停用，请选择其他商品或联系管理员恢复分类',
          details: [
            { productId: product.id, productName: product.name, nextAction: 'SELECT_PRODUCT' },
          ],
        });
      assertStockAvailable(product, item.quantity);
      if (product.price.isNegative()) throw new BadRequestException('商品价格无效');
      return {
        productId: product.id,
        productName: product.name,
        productCode: product.code,
        quantity: item.quantity,
        unitPrice: product.price.toFixed(2),
        subtotal: product.price.mul(item.quantity).toFixed(2),
      };
    });
    const amount = items.reduce((sum, item) => sum.plus(item.subtotal), new Prisma.Decimal(0));
    if (amount.gt('9999999999.99')) throw new BadRequestException('订单金额超出上限');
    const policy = await this.benefits.policy(tx);
    const pricing = memberPricing(amount, member, policy, input.benefitMode === BenefitMode.MEMBER);
    // 预览只校验和计价，不占用券；实际绑定放在创建订单的事务中。
    let couponSnapshot: {
      couponId: string;
      templateId: string;
      name: string;
      minimumSpend: string;
      discountAmount: string;
      startsAt: string;
      endsAt: string;
    } | null = null;
    if (input.couponId) {
      // 【用券查询与校验】读取会员券和原模板规则，检查归属、状态、绑定情况及有效期。
      const coupon = await tx.memberCoupon.findUnique({
        where: { id: input.couponId },
        include: { template: true },
      });
      assertCouponUsable(coupon, member.id, amount);
      // 【券后计价与快照】计算应付金额，并整理本单使用的券规则，供报价展示和创建时保存。
      pricing.discountAmount = coupon.template.discountAmount.toFixed(2);
      pricing.payableAmount = amount.minus(coupon.template.discountAmount).toFixed(2);
      couponSnapshot = {
        couponId: coupon.id,
        templateId: coupon.templateId,
        name: coupon.template.name,
        minimumSpend: coupon.template.minimumSpend.toFixed(2),
        discountAmount: coupon.template.discountAmount.toFixed(2),
        startsAt: coupon.template.startsAt.toISOString(),
        endsAt: coupon.template.endsAt.toISOString(),
      };
    }
    // 【秒杀报价】只读活动库存和会员占用，不扣库存；创建订单时才原子预占。
    let seckillSnapshot: {
      activityId: string;
      name: string;
      price: string;
      holdMinutes: number;
    } | null = null;
    if (input.activityId) {
      const activity = await tx.seckillActivity.findUnique({ where: { id: input.activityId } });
      const now = new Date();
      if (
        !activity ||
        !activity.enabled ||
        activity.startsAt > now ||
        activity.endsAt <= now ||
        activity.remainingStock < 1
      ) {
        throw new ConflictException({
          code: 'SECKILL_UNAVAILABLE',
          message: '秒杀未开始、已结束、已停用或名额已抢完',
        });
      }
      if (activity.productId !== items[0].productId || activity.price.gt(amount))
        throw new BadRequestException('秒杀商品不匹配或秒杀价高于商品现价');
      const previous = await tx.seckillReservation.findFirst({
        where: {
          activityId: activity.id,
          memberId: member.id,
          status: { in: ['RESERVED', 'CONFIRMED'] },
        },
      });
      if (previous)
        throw new ConflictException({
          code: 'SECKILL_LIMIT',
          message: '该会员已占用或购买本活动商品，每会员限购1件',
        });
      pricing.payableAmount = activity.price.toFixed(2);
      pricing.discountAmount = amount.minus(activity.price).toFixed(2);
      seckillSnapshot = {
        activityId: activity.id,
        name: activity.name,
        price: activity.price.toFixed(2),
        holdMinutes: activity.holdMinutes,
      };
    }
    const quoted = {
      storeId: store.id,
      storeName: store.name,
      memberId: member.id,
      memberName: member.name,
      items,
      originalAmount: amount.toFixed(2),
      ...pricing,
      couponSnapshot,
      seckillSnapshot,
    };
    return { ...quoted, quoteHash: hash(quoted) };
  }

  quote(user: AuthUser, dto: QuoteOrderDto) {
    return this.prisma.$transaction((tx) => this.buildQuote(tx, user, dto), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  async create(user: AuthUser, dto: CreateOrderDto) {
    const input = this.normalize(dto);
    // requestId 识别同一次提交；requestHash 防止同一个标识被用于不同内容。
    const requestHash = hash({ ...input, quoteHash: dto.quoteHash });
    // The same logical submission keeps its key even when the HTTP response is lost.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const previous = await tx.order.findUnique({
              where: { createdById_requestId: { createdById: user.id, requestId: dto.requestId } },
              include: includeOrder,
            });
            if (previous) {
              if (previous.requestHash !== requestHash)
                throw new ConflictException({
                  code: 'ORDER_REQUEST_REUSED',
                  message: '提交标识已用于另一份订单，请重新下单',
                });
              const allowed = await tx.store.findFirst({
                where: { AND: [{ id: previous.storeId }, this.scope.storeWhere(user)] },
              });
              if (!allowed) throw new NotFoundException('订单不在你的数据范围内');
              return previous;
            }
            // 【创建时复核】重新报价，规则、价格或券状态变化后不能直接使用旧预览创建。
            const quote = await this.buildQuote(tx, user, dto);
            if (quote.quoteHash !== dto.quoteHash) {
              throw new ConflictException({
                code: 'ORDER_QUOTE_CHANGED',
                message: '价格或资料已变化，请重新计算金额并确认',
              });
            }
            // 【订单写库】保存待支付订单、金额和商品/权益/券快照，与后续占券同一事务提交。
            const order = await tx.order.create({
              data: {
                orderNo: `SC-${randomUUID()}`,
                storeId: dto.storeId,
                memberId: dto.memberId,
                createdById: user.id,
                requestId: dto.requestId,
                requestHash,
                source: OrderSource.BACKOFFICE,
                status: OrderStatus.PENDING_PAYMENT,
                orderedAt: new Date(),
                originalAmount: quote.originalAmount,
                discountAmount: quote.discountAmount,
                payableAmount: quote.payableAmount,
                paidAmount: 0,
                benefitSnapshot: quote.benefitSnapshot,
                couponSnapshot: quote.couponSnapshot ?? Prisma.DbNull,
                seckillSnapshot: quote.seckillSnapshot ?? Prisma.DbNull,
                expiresAt: quote.seckillSnapshot
                  ? new Date(Date.now() + quote.seckillSnapshot.holdMinutes * 60000)
                  : new Date(Date.now() + 30 * 60000),
                items: { create: quote.items },
              },
              include: includeOrder,
            });
            await reserveStock(tx, order.id, quote.items, user.id);
            // 条件更新抢占可用券；失败时整个事务回滚，不留下无券的优惠订单。
            if (input.couponId) {
              const now = new Date();
              const reserved = await tx.memberCoupon.updateMany({
                where: {
                  id: input.couponId,
                  memberId: input.memberId,
                  status: 'AVAILABLE',
                  orderId: null,
                  template: { startsAt: { lte: now }, endsAt: { gt: now } },
                },
                data: { status: 'RESERVED', orderId: order.id, reservedAt: now },
              });
              if (!reserved.count)
                throw new ConflictException({
                  code: 'COUPON_UNAVAILABLE',
                  message: '优惠券已失效或被其他订单占用，请重新选券',
                });
            }
            if (quote.seckillSnapshot) {
              // 【原子扣库存】库存大于0且活动仍有效才减1；失败整单回滚，禁止超卖。
              const now = new Date();
              const occupied = await tx.seckillActivity.updateMany({
                where: {
                  id: quote.seckillSnapshot.activityId,
                  enabled: true,
                  startsAt: { lte: now },
                  endsAt: { gt: now },
                  remainingStock: { gt: 0 },
                },
                data: { remainingStock: { decrement: 1 } },
              });
              if (!occupied.count)
                throw new ConflictException({
                  code: 'SECKILL_UNAVAILABLE',
                  message: '活动已结束或秒杀名额已抢完',
                });
              // 【数据库限购】部分唯一索引限制每会员每活动只能有一个有效占用。
              await tx.seckillReservation.create({
                data: {
                  activityId: quote.seckillSnapshot.activityId,
                  memberId: input.memberId,
                  orderId: order.id,
                },
              });
            }
            return order;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        // 【有限重试】原始锁查询的死锁/序列化失败以P2010携带SQLSTATE返回，仍沿用同一提交标识。
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (['P2002', 'P2034'].includes(error.code) ||
            (error.code === 'P2010' &&
              typeof error.meta?.code === 'string' &&
              ['40001', '40P01'].includes(error.meta.code)))
        ) {
          if (attempt < 2) continue;
          throw new ConflictException({
            code: 'ORDER_BUSY',
            message: '订单正在处理，请保持原提交内容重试',
          });
        }
        throw error;
      }
    }
    throw new ConflictException('订单正在处理，请稍后重试');
  }

  async cancel(user: AuthUser, id: string) {
    // 取消订单和释放券一起提交；券的历史规则仍保留在订单快照中。
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: { AND: [{ id, deletedAt: null }, this.scope.orderWhere(user)] },
        include: includeOrder,
      });
      if (!existing) throw new NotFoundException('订单不存在或不在你的数据范围内');
      const changed = await tx.order.updateMany({
        where: {
          AND: [
            {
              id,
              deletedAt: null,
              source: OrderSource.BACKOFFICE,
              status: OrderStatus.PENDING_PAYMENT,
            },
            this.scope.orderWhere(user),
          ],
        },
        data: { status: OrderStatus.CANCELED, canceledAt: new Date() },
      });
      const order = await tx.order.findUniqueOrThrow({ where: { id }, include: includeOrder });
      if (
        !changed.count &&
        !(order.status === OrderStatus.CANCELED && order.source === OrderSource.BACKOFFICE)
      ) {
        throw new ConflictException('只能取消待支付的会员订单');
      }
      // 【取消后释放】只释放仍绑定本订单的占用券，重复取消旧订单不会影响后来新订单。
      // 【关闭模拟支付】取消成功后关闭未完成支付；与模拟成功通知通过订单行锁互斥。
      await tx.paymentRecord.updateMany({
        where: { orderId: id, status: 'PENDING' },
        data: { status: 'CLOSED' },
      });
      await tx.memberCoupon.updateMany({
        where: { orderId: id, status: 'RESERVED' },
        data: { status: 'AVAILABLE', orderId: null, reservedAt: null },
      });
      await transitionStock(tx, id, 'RELEASE', user.id);
      await this.releaseSeckill(tx, id);
      return order;
    });
  }

  private async releaseSeckill(tx: Prisma.TransactionClient, orderId: string) {
    // 【幂等释放库存】只把本订单的有效占用改成已释放，确实更新成功才归还一份库存。
    const reservation = await tx.seckillReservation.findUnique({ where: { orderId } });
    if (!reservation) return;
    const changed = await tx.seckillReservation.updateMany({
      where: { orderId, status: 'RESERVED' },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    if (changed.count)
      await tx.seckillActivity.update({
        where: { id: reservation.activityId },
        data: { remainingStock: { increment: 1 } },
      });
  }

  async expireSeckillOrder(id: string) {
    // 【内部超时关闭】后台任务关闭到期且仍待支付的后台订单，与归还名额同事务完成。
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: {
          id,
          status: OrderStatus.PENDING_PAYMENT,
          expiresAt: { lte: new Date() },
          source: OrderSource.BACKOFFICE,
        },
        data: { status: OrderStatus.CANCELED, canceledAt: new Date() },
      });
      if (changed.count) {
        // 【到期关闭支付】防止订单已取消而支付记录仍显示处理中。
        await tx.paymentRecord.updateMany({
          where: { orderId: id, status: 'PENDING' },
          data: { status: 'CLOSED' },
        });
        await transitionStock(tx, id, 'RELEASE', 'SYSTEM');
        await this.releaseSeckill(tx, id);
        await tx.memberCoupon.updateMany({
          where: { orderId: id, status: 'RESERVED' },
          data: { status: 'AVAILABLE', orderId: null, reservedAt: null },
        });
      }
      return changed.count;
    });
  }
}
