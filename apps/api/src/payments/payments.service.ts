import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { commerceDateRange } from '../common/commerce-query';
import type { ListPaymentRecordsDto } from './payment-records.controller';
import { transitionStock } from '../orders/product-stock';
import { DataScopeService } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { MemberBenefitsService } from '../member-benefits/member-benefits.service';
import { PrismaService } from '../prisma/prisma.service';
import { MockResultDto, RequestRefundDto } from './payment.dto';
import { MockPaymentGateway, type ChannelEvent } from './mock-payment.gateway';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly scope: DataScopeService,
    private readonly benefits: MemberBenefitsService,
    private readonly gateway: MockPaymentGateway,
  ) {}

  // 所有记录筛选与订单权限范围相交，不能由客户端条件覆盖。
  private recordOrderWhere(
    user: AuthUser,
    filters: Partial<ListPaymentRecordsDto> = {},
  ): Prisma.OrderWhereInput {
    return {
      AND: [
        { deletedAt: null },
        this.scope.orderWhere(user),
        ...(filters.orderId ? [{ id: filters.orderId }] : []),
        ...(filters.memberKeyword
          ? [
              {
                member: {
                  OR: [
                    {
                      name: {
                        contains: filters.memberKeyword.trim(),
                        mode: 'insensitive' as const,
                      },
                    },
                    { phone: { contains: filters.memberKeyword.trim() } },
                  ],
                },
              },
            ]
          : []),
        ...(filters.storeKeyword
          ? [
              {
                store: {
                  OR: [
                    {
                      name: { contains: filters.storeKeyword.trim(), mode: 'insensitive' as const },
                    },
                    {
                      code: { contains: filters.storeKeyword.trim(), mode: 'insensitive' as const },
                    },
                  ],
                },
              },
            ]
          : []),
      ],
    };
  }
  async records(
    user: AuthUser,
    kind: 'payments' | 'refunds',
    page: number,
    keyword: string,
    filters: Partial<ListPaymentRecordsDto> = {},
  ) {
    const where = {
      order: this.recordOrderWhere(user, filters),
      ...(keyword
        ? {
            OR: [
              { id: { contains: keyword, mode: 'insensitive' as const } },
              { order: { orderNo: { contains: keyword, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.startDate || filters.endDate
        ? { createdAt: commerceDateRange(filters.startDate, filters.endDate) }
        : {}),
    };
    const order = {
      select: {
        id: true,
        orderNo: true,
        member: { select: { name: true, avatarUrl: true } },
        store: { select: { name: true } },
      },
    } as const;
    const args = {
      skip: (page - 1) * 20,
      take: 20,
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    };
    const paymentWhere = { ...where, ...(filters.channel ? { channel: filters.channel } : {}) };
    const refundWhere = {
      ...where,
      ...(filters.channel ? { payment: { channel: filters.channel } } : {}),
    };
    const [items, total] =
      kind === 'payments'
        ? await this.db.$transaction([
            this.db.paymentRecord.findMany({ ...args, where: paymentWhere, include: { order } }),
            this.db.paymentRecord.count({ where: paymentWhere }),
          ])
        : await this.db.$transaction([
            this.db.refundRecord.findMany({
              ...args,
              where: refundWhere,
              include: { order, payment: { select: { channel: true } } },
            }),
            this.db.refundRecord.count({ where: refundWhere }),
          ]);
    const actors = await this.db.user.findMany({
      where: { id: { in: items.map((i) => i.actorId) } },
      select: { id: true, name: true },
    });
    return {
      items: items.map((i) => ({
        ...i,
        actorName: actors.find((a) => a.id === i.actorId)?.name || null,
      })),
      total,
      page,
      pageSize: 20,
    };
  }
  async recordDetail(user: AuthUser, kind: 'payments' | 'refunds', id: string, eventPage = 1) {
    const where = { id, order: this.recordOrderWhere(user) };
    const order = {
      select: {
        id: true,
        orderNo: true,
        member: { select: { name: true, avatarUrl: true } },
        store: { select: { name: true } },
      },
    } as const;
    const record =
      kind === 'payments'
        ? await this.db.paymentRecord.findFirst({
            where,
            include: { order, refund: { select: { id: true, status: true } } },
          })
        : await this.db.refundRecord.findFirst({
            where,
            include: { order, payment: { select: { channel: true } } },
          });
    if (!record) throw new NotFoundException('记录不存在或不在你的数据范围内');
    const eventWhere = {
      orderId: record.orderId,
      kind: kind === 'payments' ? 'PAYMENT' : 'REFUND',
    };
    const [items, total] = await this.db.$transaction([
      this.db.paymentEvent.findMany({
        where: eventWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (eventPage - 1) * 20,
        take: 20,
      }),
      this.db.paymentEvent.count({ where: eventWhere }),
    ]);
    const actor = await this.db.user.findUnique({
      where: { id: record.actorId },
      select: { name: true },
    });
    return {
      record: { ...record, actorName: actor?.name || null },
      events: { items, total, page: eventPage, pageSize: 20 },
    };
  }

  // 【资金统计】订单创建时间窗口内的支付/退款主体当前状态；金额采用Decimal聚合。
  async statistics(user: AuthUser, start: Date, end: Date) {
    const order = {
      AND: [{ deletedAt: null, orderedAt: { gte: start, lte: end } }, this.scope.orderWhere(user)],
    };
    const [payments, refunds] = await Promise.all([
      this.db.paymentRecord.groupBy({
        by: ['status', 'channel'],
        where: { order },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.db.refundRecord.groupBy({
        by: ['status'],
        where: { order },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    return {
      payments,
      refunds,
      definition:
        '按订单创建日期筛选，返回支付/退款主体当前状态与金额（不是事件发生日现金流）。MOCK为本地模拟渠道，不涉及真实资金。历史导入订单没有渠道流水。',
    };
  }

  // 【权限与并发校验】所有支付/退款修改先锁定同一订单，与取消、到期关闭争用同一行。
  private async lockedOrder(tx: Prisma.TransactionClient, user: AuthUser, id: string) {
    const visible = await tx.order.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scope.orderWhere(user)] },
      select: { id: true },
    });
    if (!visible) throw new NotFoundException('订单不存在或不在你的数据范围内');
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id } });
    if (order.source !== 'BACKOFFICE' || !order.memberId || order.deletedAt)
      throw new BadRequestException('仅支持会员下单产生的订单，历史导入单不可补支付或退款');
    return order;
  }

  async detail(user: AuthUser, orderId: string) {
    // 【记录查询】查看权限与订单一致，事件仅返回本订单最近20条，不暴露模拟签名密钥。
    const order = await this.db.order.findFirst({
      where: { AND: [{ id: orderId, deletedAt: null }, this.scope.orderWhere(user)] },
      include: { payment: true, refund: true },
    });
    if (!order) throw new NotFoundException('订单不存在或不在你的数据范围内');
    const events = await this.db.paymentEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      payment: order.payment,
      refund: order.refund,
      events,
      mockEnabled: this.gateway.enabled(),
    };
  }

  async start(user: AuthUser, orderId: string) {
    this.gateway.assertEnabled();
    return this.db.$transaction(async (tx) => {
      const order = await this.lockedOrder(tx, user, orderId);
      const previous = await tx.paymentRecord.findUnique({ where: { orderId } });
      // 【支付幂等】成功或处理中复用原支付记录；失败后显式重试，尝试号递增阻挡旧通知。
      if (previous?.status === 'SUCCEEDED') return previous;
      if (order.status !== 'PENDING_PAYMENT' || (order.expiresAt && order.expiresAt <= new Date()))
        throw new ConflictException('订单已关闭、已支付或超过支付期限');
      if (previous?.status === 'PENDING') return previous;
      return previous
        ? tx.paymentRecord.update({
            where: { id: previous.id },
            data: { status: 'PENDING', attempt: { increment: 1 }, actorId: user.id },
          })
        : tx.paymentRecord.create({
            data: { orderId, amount: order.payableAmount, actorId: user.id },
          });
    });
  }

  async requestRefund(user: AuthUser, orderId: string, dto: RequestRefundDto) {
    this.gateway.assertEnabled();
    const reason = dto.reason.trim();
    if (reason.length < 2) throw new BadRequestException('请填写至少两个字的退款原因');
    return this.db.$transaction(async (tx) => {
      const order = await this.lockedOrder(tx, user, orderId);
      const previous = await tx.refundRecord.findUnique({ where: { orderId } });
      if (order.shippedAt || order.status === 'COMPLETED')
        throw new ConflictException('订单已发货或已完成，本版本暂不支持售后退款');
      // 【退款幂等】整单退款主体一单一份；网络重试复用，失败重试沿用原原因和金额。
      if (previous) {
        if (previous.reason !== reason)
          throw new ConflictException('该订单已申请退款，请沿用原退款原因');
        if (previous.status !== 'FAILED') return previous;
      }
      const payment = await tx.paymentRecord.findUnique({ where: { orderId } });
      if (
        !payment ||
        payment.status !== 'SUCCEEDED' ||
        !['PAID', 'COMPLETED'].includes(order.status)
      )
        throw new ConflictException('仅已成功支付且未退款的订单可申请整单退款');
      if (!payment.amount.eq(order.paidAmount))
        throw new ConflictException('原支付金额异常，请人工核查');
      return previous
        ? tx.refundRecord.update({
            where: { id: previous.id },
            data: { status: 'PENDING', attempt: { increment: 1 } },
          })
        : tx.refundRecord.create({
            data: {
              orderId,
              paymentId: payment.id,
              amount: payment.amount,
              reason,
              actorId: user.id,
            },
          });
    });
  }

  async simulate(user: AuthUser, orderId: string, kind: 'PAYMENT' | 'REFUND', dto: MockResultDto) {
    this.gateway.assertEnabled();
    // 【模拟渠道通知】只模拟结果，金额从支付/退款记录读取，不接受客户端伪造金额。
    await this.detail(user, orderId);
    const record =
      kind === 'PAYMENT'
        ? await this.db.paymentRecord.findUnique({ where: { orderId } })
        : await this.db.refundRecord.findUnique({ where: { orderId } });
    if (!record) throw new BadRequestException('请先发起支付或退款');
    const event: ChannelEvent = {
      id: `${kind}:${record.id}:${dto.attempt}:${dto.outcome}`,
      orderId,
      recordId: record.id,
      kind,
      attempt: dto.attempt,
      amount: record.amount.toFixed(2),
      outcome: dto.outcome,
    };
    return this.acceptEvent(user, event, this.gateway.sign(event));
  }

  // 【通知处理入口】本地模拟同步投递；真实渠道将来应有独立回调认证、查单与补偿适配。
  async acceptEvent(user: AuthUser, event: ChannelEvent, signature: string) {
    this.gateway.assertEnabled();
    this.gateway.verify(event, signature);
    return this.db.$transaction(
      async (tx) => {
        const order = await this.lockedOrder(tx, user, event.orderId);
        const record =
          event.kind === 'PAYMENT'
            ? await tx.paymentRecord.findUnique({ where: { orderId: order.id } })
            : await tx.refundRecord.findUnique({ where: { orderId: order.id } });
        // 【通知真实性与金额校验】签名有效后仍校验记录、尝试号、金额与业务状态。
        if (
          !record ||
          record.id !== event.recordId ||
          record.attempt !== event.attempt ||
          !record.amount.eq(event.amount)
        )
          throw new ConflictException('通知记录、金额或尝试号不匹配');
        const duplicate = await tx.paymentEvent.findUnique({ where: { id: event.id } });
        if (duplicate) return { duplicate: true, status: record.status };
        if (record.status !== 'PENDING')
          throw new ConflictException('本次尝试已处理，不能覆盖处理结果');
        if (event.kind === 'PAYMENT') {
          if (
            order.status !== 'PENDING_PAYMENT' ||
            (order.expiresAt && order.expiresAt <= new Date())
          )
            throw new ConflictException('订单已关闭或超过支付期限，模拟渠道不再扣款');
          if (!order.payableAmount.eq(record.amount))
            throw new ConflictException('订单应付金额不匹配');
          await tx.paymentRecord.update({
            where: { id: record.id },
            data: {
              status: event.outcome === 'SUCCESS' ? 'SUCCEEDED' : 'FAILED',
              ...(event.outcome === 'SUCCESS' ? { paidAt: new Date() } : {}),
            },
          });
          if (event.outcome === 'SUCCESS') {
            await transitionStock(tx, order.id, 'CONSUME', user.id);
            // 【原子入账】支付、订单、券核销、秒杀成交及会员权益在同一事务中提交。
            await tx.order.update({
              where: { id: order.id },
              data: { status: 'PAID', paidAmount: record.amount },
            });
            if (order.couponSnapshot) {
              const used = await tx.memberCoupon.updateMany({
                where: { orderId: order.id, status: 'RESERVED' },
                data: { status: 'USED', usedAt: new Date() },
              });
              if (used.count !== 1) throw new ConflictException('原占用券异常，请人工核查');
            }
            if (order.seckillSnapshot) {
              const confirmed = await tx.seckillReservation.updateMany({
                where: { orderId: order.id, status: 'RESERVED' },
                data: { status: 'CONFIRMED' },
              });
              if (confirmed.count !== 1)
                throw new ConflictException('秒杀名额已释放，不能确认付款');
            }
            await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${order.memberId} FOR UPDATE`;
            await this.benefits.recordPayment(tx, order.id);
          }
        } else {
          if (order.shippedAt) throw new ConflictException('订单已发货，不能按发货前退款处理');
          if (!['PAID', 'COMPLETED'].includes(order.status) || !order.paidAmount.eq(record.amount))
            throw new ConflictException('订单状态或整单退款金额异常');
          await tx.refundRecord.update({
            where: { id: record.id },
            data: {
              status: event.outcome === 'SUCCESS' ? 'SUCCEEDED' : 'FAILED',
              ...(event.outcome === 'SUCCESS' ? { refundedAt: new Date() } : {}),
            },
          });
          if (event.outcome === 'SUCCESS') {
            await transitionStock(tx, order.id, 'REFUND', user.id);
            // 【退款回冲】按原始权益流水冲回积分消费；返原券不延有效期，秒杀成交限购保留。
            await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
            await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${order.memberId} FOR UPDATE`;
            await this.benefits.recordRefund(tx, order.id);
            await tx.memberCoupon.updateMany({
              where: { orderId: order.id, status: 'USED' },
              data: { status: 'AVAILABLE', orderId: null, reservedAt: null, usedAt: null },
            });
          }
        }
        // 【事件去重】事件与上述业务同事务写入，重复通知不会重复记账或返券。
        await tx.paymentEvent.create({
          data: {
            id: event.id,
            orderId: order.id,
            kind: event.kind,
            attempt: event.attempt,
            outcome: event.outcome,
            amount: record.amount,
          },
        });
        return { duplicate: false, status: event.outcome === 'SUCCESS' ? 'SUCCEEDED' : 'FAILED' };
      },
      { timeout: 15000 },
    );
  }
}
