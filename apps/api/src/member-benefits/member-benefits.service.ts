import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BenefitLedgerKind, OrderSource, OrderStatus, Prisma } from '@prisma/client';
import { DataScopeService } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { pagination } from '../common/api';
import { PrismaService } from '../prisma/prisma.service';
import { BenefitPageDto, UpdateBenefitPolicyDto, UpdateMemberTierDto } from './benefit.dto';
import { describeBenefits, validateTierRules } from './benefit-rules';

@Injectable()
export class MemberBenefitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}

  policy(tx: Prisma.TransactionClient = this.prisma) {
    return tx.memberBenefitPolicy.findUniqueOrThrow({ where: { id: 'default' } });
  }

  async summary(id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const member = await tx.member.findUnique({ where: { id } });
        if (!member) throw new NotFoundException('会员不存在');
        const policy = await this.policy(tx);
        return { member: { ...member, ...describeBenefits(member, policy) }, policy };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async updatePolicy(user: AuthUser, dto: UpdateBenefitPolicyDto) {
    const tiers = validateTierRules(dto.tiers);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.policy(tx);
      const changed = await tx.memberBenefitPolicy.updateMany({
        where: { id: 'default', version: dto.version },
        data: {
          enabled: dto.enabled,
          tiers,
          version: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException('权益规则已被更新，请刷新后再修改');
      const after = await this.policy(tx);
      await tx.memberBenefitAudit.create({
        data: {
          actorId: user.id,
          action: 'POLICY',
          reason: dto.reason,
          before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonObject,
          after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonObject,
        },
      });
      return after;
    });
  }

  async updateTier(user: AuthUser, id: string, dto: UpdateMemberTierDto) {
    const tierOverride = dto.tierOverride;
    if (tierOverride === undefined) throw new BadRequestException('请选择等级，自动等级请传null');
    return this.prisma.$transaction(async (tx) => {
      // Serialize manual changes to the same member so the audit has the actual previous state.
      await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${id} FOR UPDATE`;
      const member = await tx.member.findUnique({ where: { id } });
      if (!member) throw new NotFoundException('会员不存在');
      await tx.member.update({ where: { id }, data: { tierOverride } });
      await tx.memberBenefitAudit.create({
        data: {
          memberId: id,
          actorId: user.id,
          action: 'TIER',
          reason: dto.reason,
          before: { tierOverride: member.tierOverride },
          after: { tierOverride },
        },
      });
      const policy = await this.policy(tx);
      const updated = { ...member, tierOverride };
      return { ...updated, ...describeBenefits(updated, policy) };
    });
  }

  async ledger(user: AuthUser, id: string, query: BenefitPageDto) {
    await this.summary(id);
    const p = pagination(query.page, query.pageSize);
    const where: Prisma.MemberBenefitLedgerWhereInput = {
      memberId: id,
      order: { AND: [{ deletedAt: null }, this.scope.orderWhere(user)] },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.memberBenefitLedger.findMany({
        where,
        skip: p.skip,
        take: p.take,
        include: { order: { select: { orderNo: true, store: { select: { name: true } } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.memberBenefitLedger.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async audits(id: string) {
    await this.summary(id);
    return this.prisma.memberBenefitAudit.findMany({
      where: { memberId: id },
      take: 20,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { actor: { select: { name: true } } },
    });
  }

  // Internal integration point. The future payment service must call this inside
  // the SAME serializable transaction that confirms payment; there is no HTTP reward endpoint.
  async recordPayment(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (
      !order?.memberId ||
      order.deletedAt !== null ||
      order.source !== OrderSource.BACKOFFICE ||
      !([OrderStatus.PAID, OrderStatus.COMPLETED] as OrderStatus[]).includes(order.status) ||
      order.paidAmount.isNegative() ||
      !order.paidAmount.eq(order.payableAmount)
    )
      throw new BadRequestException('仅已确认全额付款的会员订单可累计权益');
    const existing = await tx.memberBenefitLedger.findUnique({
      where: { orderId_kind: { orderId, kind: BenefitLedgerKind.PAYMENT } },
    });
    if (existing) return existing;
    const policy = await this.policy(tx);
    const member = await tx.member.findUniqueOrThrow({ where: { id: order.memberId } });
    const snapshot =
      order.benefitSnapshot &&
      typeof order.benefitSnapshot === 'object' &&
      !Array.isArray(order.benefitSnapshot)
        ? order.benefitSnapshot
        : null;
    const pointsPerYuan = snapshot?.pointsPerYuan ?? describeBenefits(member, policy).pointsPerYuan;
    const ruleVersion =
      snapshot?.pointsPerYuan === undefined
        ? policy.version
        : (snapshot.policyVersion ?? policy.version);
    if (
      typeof pointsPerYuan !== 'number' ||
      !Number.isInteger(pointsPerYuan) ||
      pointsPerYuan < 1 ||
      pointsPerYuan > 10 ||
      typeof ruleVersion !== 'number' ||
      !Number.isInteger(ruleVersion) ||
      ruleVersion < 1
    ) {
      throw new ConflictException('订单权益快照无效，请人工核查');
    }
    const points = order.paidAmount.floor().mul(pointsPerYuan).toNumber();
    if (
      !Number.isSafeInteger(points) ||
      member.points + points > 2147483647 ||
      member.totalSpent.plus(order.paidAmount).gt('999999999999.99')
    ) {
      throw new ConflictException('会员累计权益超出上限，请人工核查');
    }
    const entry = await tx.memberBenefitLedger.create({
      data: {
        memberId: order.memberId,
        orderId,
        kind: BenefitLedgerKind.PAYMENT,
        amount: order.paidAmount,
        pointsDelta: points,
        ruleVersion,
      },
    });
    await tx.member.update({
      where: { id: order.memberId },
      data: {
        totalSpent: { increment: order.paidAmount },
        points: { increment: points },
      },
    });
    return entry;
  }

  // Full refunds reverse the recorded original reward, not the latest policy.
  async recordRefund(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (
      !order?.memberId ||
      order.source !== OrderSource.BACKOFFICE ||
      order.status !== OrderStatus.REFUNDED
    ) {
      throw new BadRequestException('仅已确认全额退款的会员订单可冲回权益');
    }
    const existing = await tx.memberBenefitLedger.findUnique({
      where: { orderId_kind: { orderId, kind: BenefitLedgerKind.REFUND } },
    });
    if (existing) return existing;
    const earned = await tx.memberBenefitLedger.findUnique({
      where: { orderId_kind: { orderId, kind: BenefitLedgerKind.PAYMENT } },
    });
    if (!earned) throw new ConflictException('没有原始权益入账记录，请核查支付处理');
    if (earned.memberId !== order.memberId)
      throw new ConflictException('订单会员与原权益记录不一致，请人工核查');
    const changed = await tx.member.updateMany({
      where: {
        id: order.memberId,
        totalSpent: { gte: earned.amount },
        points: { gte: earned.pointsDelta },
      },
      data: { totalSpent: { decrement: earned.amount }, points: { decrement: earned.pointsDelta } },
    });
    if (!changed.count) throw new ConflictException('会员权益余额异常，请人工核查');
    return tx.memberBenefitLedger.create({
      data: {
        memberId: order.memberId,
        orderId,
        kind: BenefitLedgerKind.REFUND,
        amount: earned.amount.negated(),
        pointsDelta: -earned.pointsDelta,
        ruleVersion: earned.ruleVersion,
      },
    });
  }
}
