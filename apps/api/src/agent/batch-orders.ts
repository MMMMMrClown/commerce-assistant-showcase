import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { Prisma, type AgentAction } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../common/api';
import { BenefitMode, CreateOrderDto, QuoteOrderDto } from '../orders/order.dto';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { maskPhone } from './member-tools';
import { toolError } from './tool-error';

export const batchOrdersSchema = z
  .object({
    selection: z.literal('RANDOM_EXISTING'),
    memberCount: z.number().int().min(1).max(20),
    storeId: z.string().min(1).max(100),
    productId: z.string().min(1).max(100).optional(),
    quantityPerMember: z.number().int().min(1).max(20),
    benefitMode: z.enum(['MEMBER', 'NONE', 'SECKILL']),
    activityId: z.string().min(1).max(100).optional(),
  })
  .strict();

type BatchRow = {
  member: { id: string; name: string; maskedPhone: string };
  input: QuoteOrderDto;
  requestId: string;
  quoteHash: string;
  originalAmount: string;
  discountAmount: string;
  payableAmount: string;
};
export type BatchPayload = {
  batch: {
    selection: 'RANDOM_EXISTING';
    storeName: string;
    productName: string;
    activityName?: string;
    benefitMode: string;
    quantityPerMember: number;
    totalAmount: string;
    rows: BatchRow[];
  };
};
type RowResult = {
  memberId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  id?: string;
  orderNo?: string;
  payableAmount?: string;
  message?: string;
};
export function batchResult(rows: RowResult[]) {
  const succeeded = rows.filter((r) => r.status === 'SUCCEEDED').length;
  const failed = rows.filter((r) => r.status === 'FAILED').length;
  return {
    status:
      succeeded + failed < rows.length ? 'IN_PROGRESS' : failed ? 'PARTIAL_FAILED' : 'ALL_CREATED',
    succeeded,
    failed,
    pending: rows.length - succeeded - failed,
    rows,
  };
}

// 名单由服务端选择并冻结，模型不能指定随机结果、报价或幂等键。
export class BatchOrders {
  constructor(
    private readonly db: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  policy(user: AuthUser) {
    if (
      !['dashboard:view', 'order:create', 'member:view', 'product:view', 'store:view'].every((p) =>
        user.permissions.includes(p),
      ) ||
      !user.roles.some((r) => r.dataScope === 'ALL')
    )
      throw new ForbiddenException('批量代客下单需要订单创建、会员/商品/门店查看权限及ALL范围');
  }

  async preview(user: AuthUser, input: unknown, lastActivityId?: string): Promise<BatchPayload> {
    this.policy(user);
    const args = batchOrdersSchema.parse(input);
    let activity: { id: string; productId: string; name: string } | undefined;
    if (args.benefitMode === 'SECKILL') {
      if (args.quantityPerMember !== 1)
        throw new BadRequestException(
          `秒杀每会员限购1件；${args.memberCount}位会员最多购买${args.memberCount}件，请修改人数或数量`,
        );
      const id = args.activityId || lastActivityId;
      if (!id) throw new BadRequestException('请先明确秒杀活动');
      const row = await this.db.seckillActivity.findUnique({ where: { id } });
      const now = new Date();
      if (!row?.enabled || row.startsAt > now || row.endsAt <= now)
        throw new BadRequestException('秒杀活动未开始、已结束或已停用');
      if (row.remainingStock < args.memberCount)
        throw new BadRequestException(
          `活动剩余名额${row.remainingStock}，不足创建${args.memberCount}笔订单`,
        );
      if (args.productId && args.productId !== row.productId)
        throw new BadRequestException('商品与秒杀活动不匹配');
      activity = row;
    } else if (args.activityId) throw new BadRequestException('普通订单不能携带秒杀活动');
    const productId = activity?.productId || args.productId;
    if (!productId) throw new BadRequestException('请先明确要购买的商品');
    const product = await this.db.product.findUnique({ where: { id: productId } });
    if (!product || product.deletedAt || !product.enabled)
      throw new BadRequestException('商品不存在或已下架');
    if (
      product.stockOnHand !== null &&
      product.stockOnHand - product.stockReserved < args.memberCount * args.quantityPerMember
    )
      throw new BadRequestException('商品可售库存不足以完成本批订单，请减少数量');
    const store = await this.db.store.findUnique({ where: { id: args.storeId } });
    if (!store?.enabled) throw new BadRequestException('门店不存在或已停用');
    const activityId = activity?.id || '';
    const members = await this.db.$queryRaw<{ id: string; name: string; phone: string }[]>`
      SELECT m."id", m."name", m."phone" FROM "Member" m
      WHERE m."enabled" = true AND NOT EXISTS (
        SELECT 1 FROM "SeckillReservation" r WHERE r."memberId" = m."id"
          AND r."activityId" = ${activityId} AND r."status" IN ('RESERVED', 'CONFIRMED')
      ) ORDER BY random() LIMIT ${args.memberCount}`;
    if (members.length !== args.memberCount)
      throw new BadRequestException(
        `符合条件的已有会员仅${members.length}位，不足${args.memberCount}位；不会新建或重复选择会员`,
      );
    const rows: BatchRow[] = [];
    let total = new Prisma.Decimal(0);
    for (const member of members) {
      const dto = plainToInstance(QuoteOrderDto, {
        memberId: member.id,
        storeId: store.id,
        items: [{ productId, quantity: args.quantityPerMember }],
        benefitMode: BenefitMode[args.benefitMode],
        ...(activity ? { activityId: activity.id } : {}),
      });
      const quote = await this.orders.quote(user, dto);
      total = total.plus(quote.payableAmount);
      rows.push({
        member: { id: member.id, name: member.name, maskedPhone: maskPhone(member.phone) },
        input: dto,
        quoteHash: quote.quoteHash,
        requestId: randomUUID(),
        originalAmount: quote.originalAmount,
        discountAmount: quote.discountAmount,
        payableAmount: quote.payableAmount,
      });
    }
    return {
      batch: {
        selection: args.selection,
        storeName: store.name,
        productName: product.name,
        ...(activity ? { activityName: activity.name } : {}),
        benefitMode: args.benefitMode,
        quantityPerMember: args.quantityPerMember,
        totalAmount: total.toFixed(2),
        rows,
      },
    };
  }

  private async currentUser(user: AuthUser) {
    const fresh = await this.db.user.findUnique({
      where: { id: user.id },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!fresh?.enabled) throw new ForbiddenException('账号已停用');
    const updated: AuthUser = {
      ...user,
      regionId: fresh.regionId,
      storeId: fresh.storeId,
      roles: fresh.roles.map(({ role }) => ({
        code: role.code,
        name: role.name,
        dataScope: role.dataScope,
      })),
      permissions: [
        ...new Set(
          fresh.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.code),
          ),
        ),
      ],
    };
    this.policy(updated);
    return updated;
  }

  async execute(user: AuthUser, action: AgentAction) {
    const { rows } = (action.payload as unknown as BatchPayload).batch;
    const saved = action.result as unknown as ReturnType<typeof batchResult> | null;
    const results: RowResult[] =
      saved?.rows || rows.map((r) => ({ memberId: r.member.id, status: 'PENDING' }));
    const checkpoint = async () => {
      const updated = await this.db.agentAction.updateMany({
        where: { id: action.id, status: 'EXECUTING', version: action.version + 1 },
        data: {
          result: JSON.parse(JSON.stringify(batchResult(results))) as Prisma.InputJsonValue,
          leaseUntil: new Date(Date.now() + 120000),
        },
      });
      if (!updated.count) throw new ConflictException('批次执行权已变化，请核对原批次');
    };
    for (const [index, row] of rows.entries()) {
      if (['SUCCEEDED', 'FAILED'].includes(results[index].status)) continue;
      await checkpoint();
      const current = await this.currentUser(user);
      try {
        const dto = plainToInstance(CreateOrderDto, {
          ...row.input,
          quoteHash: row.quoteHash,
          requestId: row.requestId,
        });
        const order = await this.orders.create(current, dto);
        results[index] = {
          memberId: row.member.id,
          status: 'SUCCEEDED',
          id: order.id,
          orderNo: order.orderNo,
          payableAmount: order.payableAmount.toFixed(2),
        };
      } catch (error) {
        const known =
          error instanceof HttpException && error.getStatus() >= 400 && error.getStatus() < 500;
        results[index] = {
          memberId: row.member.id,
          status: known ? 'FAILED' : 'UNKNOWN',
          message: known ? toolError(error).message : '结果待核对，恢复时沿用原订单请求编号',
        };
        await checkpoint();
        if (!known) throw error;
      }
      await checkpoint();
    }
    return batchResult(results);
  }
}
