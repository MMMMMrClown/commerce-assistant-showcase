import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertTemplateIssuable } from './coupon-feedback';
import { commerceDateRange } from '../common/commerce-query';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/api';
import {
  BatchIssueCouponDto,
  ListCouponRecordsDto,
  CreateCouponTemplateDto,
  IssueCouponDto,
  UpdateCouponTemplateDto,
} from './coupon.dto';

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  // 【只读记录】使用实际会员券和其绑定的模板版本，不丢弃已停发模板的历史记录。
  async records(query: ListCouponRecordsDto) {
    const now = new Date(),
      range = commerceDateRange(query.startDate, query.endDate);
    const where: Prisma.MemberCouponWhereInput = {
      ...(query.templateId ? { templateId: query.templateId } : {}),
      ...(query.keyword
        ? {
            OR: [
              { member: { name: { contains: query.keyword.trim(), mode: 'insensitive' } } },
              { member: { phone: { contains: query.keyword.trim() } } },
              { template: { name: { contains: query.keyword.trim(), mode: 'insensitive' } } },
              { id: { contains: query.keyword.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.startDate || query.endDate ? { createdAt: range } : {}),
      ...(query.status
        ? ['EXPIRED', 'NOT_STARTED', 'AVAILABLE'].includes(query.status)
          ? {
              status: 'AVAILABLE',
              template:
                query.status === 'EXPIRED'
                  ? { endsAt: { lte: now } }
                  : query.status === 'NOT_STARTED'
                    ? { startsAt: { gt: now }, endsAt: { gt: now } }
                    : { startsAt: { lte: now }, endsAt: { gt: now } },
            }
          : { status: query.status as 'RESERVED' | 'USED' | 'VOID' }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.memberCoupon.findMany({
        where,
        skip: (query.page - 1) * 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          member: { select: { id: true, name: true, phone: true, enabled: true, avatarUrl: true } },
          template: true,
          status: true,
          createdAt: true,
          batchId: true,
          issuedBy: { select: { name: true } },
        },
      }),
      this.prisma.memberCoupon.count({ where }),
    ]);
    const grants = await this.prisma.marketingGrant.findMany({
      where: { couponId: { in: items.map((c) => c.id) } },
      select: { couponId: true, kind: true },
    });
    return {
      items: items.map((c) => ({
        ...c,
        member: { ...c.member, phone: c.member.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') },
        source: grants.find((g) => g.couponId === c.id)?.kind || (c.batchId ? 'BATCH' : 'MANUAL'),
        displayStatus:
          c.status !== 'AVAILABLE'
            ? c.status
            : c.template.endsAt <= now
              ? 'EXPIRED'
              : c.template.startsAt > now
                ? 'NOT_STARTED'
                : 'AVAILABLE',
      })),
      total,
      page: query.page,
      pageSize: 20,
    };
  }
  templates() {
    // 【数据库查询】只返回未删除的模板，用于前端发券和模板管理下拉框。
    return this.prisma.couponTemplate.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  createTemplate(dto: CreateCouponTemplateDto) {
    // 【规则校验与保存】先校验模板规则，再新增模板记录。
    return this.prisma.couponTemplate.create({ data: this.templateData(dto) });
  }

  private templateData(dto: CreateCouponTemplateDto) {
    // 【业务校验】名称、门槛、优惠金额和有效期必须满足规则；新建和修改复用。
    const minimum = new Prisma.Decimal(dto.minimumSpend);
    const discount = new Prisma.Decimal(dto.discountAmount);
    const startsAt = new Date(dto.startsAt),
      endsAt = new Date(dto.endsAt);
    if (dto.name.trim().length < 2 || minimum.lte(0) || discount.lte(0) || discount.gt(minimum)) {
      throw new BadRequestException('门槛和优惠必须大于0，优惠不能超过门槛，名称至少2个字');
    }
    if (startsAt >= endsAt || endsAt <= new Date()) {
      throw new BadRequestException('结束时间必须晚于开始时间和当前时间');
    }
    return {
      name: dto.name.trim(),
      minimumSpend: minimum,
      discountAmount: discount,
      startsAt,
      endsAt,
    };
  }

  async updateTemplate(id: string, dto: UpdateCouponTemplateDto) {
    const data = this.templateData(dto);
    // 发布新版本替代旧模板，已发会员券仍引用旧规则，不改变既有权益。
    return this.prisma.$transaction(async (tx) => {
      // 【并发保护】锁定旧模板，再按版本停发，避免与其他编辑或发券操作交叉。
      await tx.$queryRaw`SELECT "id" FROM "CouponTemplate" WHERE "id" = ${id} FOR UPDATE`;
      const changed = await tx.couponTemplate.updateMany({
        where: { id, version: dto.version, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (!changed.count) {
        const current = await tx.couponTemplate.findUnique({ where: { id } });
        throw new ConflictException({
          code: 'COUPON_TEMPLATE_CHANGED',
          message: current?.deletedAt
            ? '优惠券“' + current.name + '”的旧模板已停止发放，请刷新后选择当前版本'
            : current
              ? '优惠券“' + current.name + '”的规则已变化，请刷新后核对再保存'
              : '券模板已不存在，请刷新模板列表',
          details: [{ templateId: id, nextAction: 'RELOAD_TEMPLATE' }],
        });
      }
      // 【新版本保存】新增替代模板，已发会员券继续关联旧模板。
      return tx.couponTemplate.create({ data: { ...data, version: dto.version + 1 } });
    });
  }

  async deleteTemplate(id: string) {
    // 删除只停止后续发放，不删除已发会员券及其历史规则。
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CouponTemplate" WHERE "id" = ${id} FOR UPDATE`;
      const template = await tx.couponTemplate.findUnique({ where: { id } });
      if (!template) throw new NotFoundException('券模板不存在');
      if (!template.deletedAt)
        await tx.couponTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
      return { id, deleted: true };
    });
  }

  async voidCoupon(memberId: string, id: string) {
    // 【条件作废】只更新属于该会员、尚未绑定订单的可用券；与订单占用竞争时不会同时成功。
    const changed = await this.prisma.memberCoupon.updateMany({
      where: { id, memberId, status: 'AVAILABLE', orderId: null },
      data: { status: 'VOID' },
    });
    if (!changed.count) {
      // 【失败判定与幂等】重复作废视为成功；不存在、已占用或已核销则返回对应错误。
      const previous = await this.prisma.memberCoupon.findFirst({ where: { id, memberId } });
      if (!previous) throw new NotFoundException('会员券不存在');
      if (previous.status !== 'VOID')
        throw new ConflictException({
          code: 'COUPON_VOID_BLOCKED',
          message:
            previous.status === 'RESERVED'
              ? '该券已被订单占用，不能作废，请先核对会员券状态'
              : previous.status === 'USED'
                ? '该券已核销，不能作废，请核对原交易记录'
                : '该券当前不能作废，请刷新后核对会员券状态',
          details: [{ couponId: id, status: previous.status, nextAction: 'CHECK_MEMBER_COUPON' }],
        });
    }
    return { id, voided: true };
  }

  async issueBatch(user: AuthUser, dto: BatchIssueCouponDto) {
    // 【目标校验与整理】区分勾选ID和跨页全选，去重排序ID，整理搜索条件。
    if (dto.mode === 'ALL' && dto.memberIds !== undefined)
      throw new BadRequestException('全选发券不接受会员ID列表');
    const memberIds = [...new Set(dto.memberIds ?? [])].sort();
    const keyword = dto.keyword?.trim() ?? '';
    // 【防重摘要】记录本次模板和目标范围，防止同一提交标识被用于不同发券内容。
    const targetHash = createHash('sha256')
      .update(
        JSON.stringify({
          templateId: dto.templateId,
          mode: dto.mode,
          target: dto.mode === 'ALL' ? keyword : memberIds,
        }),
      )
      .digest('hex');
    const key = { issuedById: user.id, requestId: dto.requestId };
    const reuse = (batch: { id: string; count: number; targetHash: string }) => {
      if (batch.targetHash !== targetHash)
        throw new ConflictException('批次标识已用于其他发券内容');
      return { batchId: batch.id, count: batch.count };
    };
    // 批次记录和全部会员券一次提交；重试返回原批次，不向新会员重复发放。
    for (let attempt = 0; attempt < 3; attempt++) {
      // 【重复请求检查】已处理的批次直接返回原结果，不再次给会员发券。
      const previous = await this.prisma.couponIssueBatch.findUnique({
        where: { issuedById_requestId: key },
      });
      if (previous) return reuse(previous);
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // 【模板校验】与模板修改/删除互斥，拒绝向已删除或过期模板继续发券。
            await tx.$queryRaw`SELECT "id" FROM "CouponTemplate" WHERE "id" = ${dto.templateId} FOR UPDATE`;
            const template = await tx.couponTemplate.findUnique({ where: { id: dto.templateId } });
            assertTemplateIssuable(template);
            // 【目标会员查询】全选由后端按搜索条件查全部启用会员，不受前端分页限制。
            const members = await tx.member.findMany({
              where: {
                enabled: true,
                ...(dto.mode === 'SELECTED'
                  ? { id: { in: memberIds } }
                  : keyword
                    ? {
                        OR: [
                          { name: { contains: keyword, mode: 'insensitive' } },
                          { phone: { contains: keyword } },
                        ],
                      }
                    : {}),
              },
              select: { id: true },
              orderBy: { id: 'asc' },
            });
            if (!members.length) throw new BadRequestException('没有可发券的启用会员');
            // 【选择有效性校验】勾选的会员若已停用或不存在，整批拒绝，不静默漏发。
            if (dto.mode === 'SELECTED' && members.length !== memberIds.length)
              throw new BadRequestException('所选会员不存在或已停用，请刷新后重新选择');
            // 【批量写入】批次和会员券在同一事务提交；每1000条分块，每人一张。
            const batch = await tx.couponIssueBatch.create({
              data: { ...key, templateId: dto.templateId, targetHash, count: members.length },
            });
            for (let offset = 0; offset < members.length; offset += 1000) {
              await tx.memberCoupon.createMany({
                data: members.slice(offset, offset + 1000).map((member) => ({
                  memberId: member.id,
                  templateId: dto.templateId,
                  issuedById: user.id,
                  requestId: dto.requestId + ':' + member.id,
                  batchId: batch.id,
                })),
              });
            }
            return { batchId: batch.id, count: batch.count };
          },
          { timeout: 30000 },
        );
      } catch (error) {
        // 【并发重试】唯一约束或事务冲突时有限重试，再次查询原批次。
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code)
        ) {
          if (attempt < 2) continue;
          throw new ConflictException('批量发券正在处理，请保持选择不变并重试');
        }
        throw error;
      }
    }
    throw new ConflictException('批量发券繁忙，请重试');
  }

  async list(memberId: string) {
    // 【会员校验】先确认会员存在，再读取该会员的券与对应规则。
    if (!(await this.prisma.member.findUnique({ where: { id: memberId } }))) {
      throw new NotFoundException('会员不存在');
    }
    const now = new Date();
    const coupons = await this.prisma.memberCoupon.findMany({
      where: { memberId },
      // 会员券是共享资料，不返回关联订单ID，订单访问仍走订单权限。
      select: { id: true, status: true, createdAt: true, template: true },
      orderBy: { createdAt: 'desc' },
    });
    // 【展示状态整理】未占用券按有效期补充“未生效/已过期”，不改写数据库状态。
    return coupons.map((coupon) => ({
      ...coupon,
      displayStatus:
        coupon.status !== 'AVAILABLE'
          ? coupon.status
          : coupon.template.endsAt <= now
            ? 'EXPIRED'
            : coupon.template.startsAt > now
              ? 'NOT_STARTED'
              : 'AVAILABLE',
    }));
  }

  async issue(user: AuthUser, memberId: string, dto: IssueCouponDto) {
    // 同一次发券重试返回原券；更换会员或模板必须使用新的提交标识。
    const key = { issuedById: user.id, requestId: dto.requestId };
    const reuse = (coupon: { memberId: string; templateId: string }) => {
      if (coupon.memberId !== memberId || coupon.templateId !== dto.templateId) {
        throw new ConflictException('发券标识已用于其他会员或模板');
      }
    };
    const previous = await this.prisma.memberCoupon.findUnique({
      where: { issuedById_requestId: key },
    });
    if (previous) {
      // 【重复发券检查】同一标识内容一致则返回原券，内容不同则拒绝。
      reuse(previous);
      return previous;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        return this.issueInTransaction(tx, user.id, memberId, dto.templateId, dto.requestId);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // 【并发防重】同时提交撞到唯一约束时，查询并返回先成功创建的券。
        const existing = await this.prisma.memberCoupon.findUniqueOrThrow({
          where: { issuedById_requestId: key },
        });
        reuse(existing);
        return existing;
      }
      throw error;
    }
  }
  async issueInTransaction(
    tx: Prisma.TransactionClient,
    actorId: string,
    memberId: string,
    templateId: string,
    requestId: string,
  ) {
    // 【会员与模板校验】锁住模板以避开编辑/删除，检查会员启用及模板是否可发。
    await tx.$queryRaw`SELECT "id" FROM "CouponTemplate" WHERE "id" = ${templateId} FOR UPDATE`;
    const member = await tx.member.findUnique({ where: { id: memberId } });
    if (!member?.enabled) throw new BadRequestException('会员不存在或已停用，不能发券');
    const template = await tx.couponTemplate.findUnique({ where: { id: templateId } });
    assertTemplateIssuable(template);
    // 【发券写库】新增该会员的一张AVAILABLE券；此时不绑定订单，也不核销。
    return tx.memberCoupon.create({
      data: { issuedById: actorId, requestId, memberId, templateId },
    });
  }
}
