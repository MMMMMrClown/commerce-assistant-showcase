import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { type AgentAction, Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../common/api';
import { PrismaService } from '../prisma/prisma.service';
import type { ExecutionContext } from './actions';
import { maskPhone, type MemberState } from './member-tools';
import {
  productEditSchema,
  productCreateSchema,
  productRenameSchema,
  memberEditSchema,
  couponIssueSchema,
  couponTemplateSchema,
  couponTemplateUpdateSchema,
  couponTemplateDisableSchema,
  couponVoidSchema,
  seckillToggleSchema,
} from './commerce-schemas';
import { BUSINESS_OPERATIONS } from './business-operations';
import { CATALOG_OPERATIONS } from './catalog-operations';
import { toolError } from './tool-error';
import { quoteSchema, seckillSchema } from './commerce-schemas';

const id = z.string().min(1).max(100);
export const memberSelectionSchema = z
  .object({
    mode: z.enum(['RANDOM', 'EXPLICIT']),
    count: z.number().int().min(1).max(20).optional(),
    memberIds: z.array(id).min(1).max(20).optional(),
    names: z.array(z.string().trim().min(1).max(80)).min(1).max(20).optional(),
    phones: z
      .array(z.string().regex(/^\d{11}$/))
      .min(1)
      .max(20)
      .optional(),
    enabledOnly: z.boolean().default(true),
    activityId: id.optional(),
  })
  .strict();
export type MemberSelection = {
  id: string;
  members: { id: string; name: string; maskedPhone: string }[];
};
export async function selectBatchMembers(
  db: PrismaService,
  user: AuthUser,
  input: unknown,
  state: MemberState,
) {
  if (!user.permissions.includes('member:view') || !user.roles.some((r) => r.dataScope === 'ALL'))
    throw new ForbiddenException('批量选择会员需要member:view与ALL范围');
  const args = memberSelectionSchema.parse(input);
  delete state.memberSelection;
  if (args.activityId && !(await db.seckillActivity.findUnique({ where: { id: args.activityId } })))
    throw new BadRequestException('秒杀活动不存在');
  const eligible: Prisma.MemberWhereInput = {
    ...(args.enabledOnly ? { enabled: true } : {}),
    ...(args.activityId
      ? {
          seckillReservations: {
            none: { activityId: args.activityId, status: { in: ['RESERVED', 'CONFIRMED'] } },
          },
        }
      : {}),
  };
  let members: { id: string; name: string; phone: string }[];
  if (args.mode === 'RANDOM') {
    if (!args.count || args.memberIds || args.names || args.phones)
      throw new BadRequestException('随机选人须明确人数，不能混入指定名单');
    const activityId = args.activityId || '';
    members = await db.$queryRaw`
      SELECT m."id", m."name", m."phone" FROM "Member" m
      WHERE (${!args.enabledOnly} OR m."enabled" = true) AND NOT EXISTS (
        SELECT 1 FROM "SeckillReservation" r WHERE r."memberId"=m."id" AND r."activityId"=${activityId}
        AND r."status" IN ('RESERVED','CONFIRMED')
      ) ORDER BY random() LIMIT ${args.count}`;
    if (members.length !== args.count)
      throw new BadRequestException(`合格会员仅${members.length}位，不足${args.count}位`);
  } else {
    if (args.count || [args.memberIds, args.names, args.phones].filter(Boolean).length !== 1)
      throw new BadRequestException('指定会员须提供一组真实ID、完整姓名或手机号，不混用');
    const requested = args.memberIds || args.names || args.phones!;
    if (new Set(requested).size !== requested.length)
      throw new BadRequestException('会员名单存在重复项');
    members = await db.member.findMany({
      where: {
        AND: [
          eligible,
          args.memberIds
            ? { id: { in: args.memberIds } }
            : args.names
              ? { name: { in: args.names } }
              : { phone: { in: args.phones } },
        ],
      },
      select: { id: true, name: true, phone: true },
    });
    if (args.names?.some((name) => members.filter((m) => m.name === name).length > 1))
      throw new BadRequestException('名单含同名会员，请先查询消歧，使用真实会员ID重新选择');
    if (members.length !== requested.length)
      throw new BadRequestException(
        '名单中有不存在、停用或不符合活动资格的会员，请核对，不会自动替换',
      );
  }
  const selection = {
    id: randomUUID(),
    members: members.map((m) => ({ id: m.id, name: m.name, maskedPhone: maskPhone(m.phone) })),
  };
  state.memberSelection = selection;
  return {
    ok: true,
    selection,
    definition:
      '仅选择并固定已有会员，尚未执行业务。此名单可复用于发券、活动下单、会员资料及等级调整，需逐项预览确认。',
  };
}
export const productSelectionSchema = z
  .object({
    productIds: z.array(id).min(1).max(20).optional(),
    names: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
    codes: z.array(z.string().trim().min(1).max(60)).min(1).max(20).optional(),
  })
  .strict();
export type ProductSelection = {
  id: string;
  products: { id: string; name: string; code: string }[];
};
export async function selectBatchProducts(
  db: PrismaService,
  user: AuthUser,
  input: unknown,
  state: MemberState,
) {
  if (!user.permissions.includes('product:view') || !user.roles.some((r) => r.dataScope === 'ALL'))
    throw new ForbiddenException('批量商品选择需要product:view与ALL范围');
  const args = productSelectionSchema.parse(input);
  delete state.productSelection;
  if ([args.productIds, args.names, args.codes].filter(Boolean).length !== 1)
    throw new BadRequestException('请提供一组商品ID、完整名称或编号，不混用');
  const requested = args.productIds || args.names || args.codes!;
  if (new Set(requested).size !== requested.length) throw new BadRequestException('商品名单重复');
  const products = await db.product.findMany({
    where: {
      deletedAt: null,
      ...(args.productIds
        ? { id: { in: args.productIds } }
        : args.names
          ? { name: { in: args.names } }
          : { code: { in: args.codes } }),
    },
    select: { id: true, name: true, code: true },
  });
  if (args.names?.some((name) => products.filter((p) => p.name === name).length > 1))
    throw new BadRequestException('存在同名商品，请使用明确的商品编号或ID');
  if (products.length !== requested.length)
    throw new BadRequestException('部分商品不存在或已移入回收站，不会自动替换');
  const selection = { id: randomUUID(), products };
  state.productSelection = selection;
  return {
    ok: true,
    selection,
    definition: '指定商品集合已固定，可复用修改价格、库存、上下架和其他资料；尚未执行业务。',
  };
}

const stockChange = z
  .object({
    productId: id,
    mode: z.enum(['SET', 'ADD']),
    quantity: z.number().int().min(-1000000000).max(1000000000),
    warning: z.number().int().min(0).max(1000000000).optional(),
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export const productStockSchema = stockChange;
export const generatedMembersSchema = z
  .object({
    count: z.number().int().min(1).max(20),
    namePrefix: z.string().trim().min(1).max(40).default('测试会员'),
  })
  .strict();
// 此白名单复用现有业务schema，批量编排不能获得单项工具之外的字段或权限。
export const BATCH_OPERATIONS = [
  {
    operation: 'MEMBER_CREATE',
    schema: z
      .object({ name: z.string().trim().min(1).max(80), phone: z.string().regex(/^\d{11}$/) })
      .strict(),
  },
  { operation: 'MEMBER_EDIT', schema: memberEditSchema.extend({ memberId: id.optional() }) },
  { operation: 'PRODUCT_EDIT', schema: productEditSchema.extend({ productId: id.optional() }) },
  { operation: 'PRODUCT_STOCK', schema: productStockSchema.extend({ productId: id.optional() }) },
  { operation: 'PRODUCT_CREATE', schema: productCreateSchema },
  { operation: 'PRODUCT_RENAME', schema: productRenameSchema },
  {
    operation: 'COUPON_ISSUE',
    schema: couponIssueSchema.extend({ memberIds: z.array(id).min(1).max(20).optional() }),
  },
  { operation: 'COUPON_TEMPLATE_CREATE', schema: couponTemplateSchema },
  { operation: 'COUPON_TEMPLATE_UPDATE', schema: couponTemplateUpdateSchema },
  { operation: 'COUPON_TEMPLATE_DISABLE', schema: couponTemplateDisableSchema },
  { operation: 'COUPON_VOID', schema: couponVoidSchema },
  { operation: 'SECKILL_TOGGLE', schema: seckillToggleSchema },
  { operation: 'SECKILL_CREATE', schema: seckillSchema },
  { operation: 'ORDER_CREATE', schema: quoteSchema.extend({ memberId: id.optional() }) },
  { operation: 'ORDER_CANCEL', schema: z.object({ orderId: id }).strict() },
  { operation: 'PAYMENT', schema: z.object({ orderId: id }).strict() },
  {
    operation: 'REFUND',
    schema: z.object({ orderId: id, reason: z.string().trim().min(2).max(200) }).strict(),
  },
  { operation: 'ORDER_SHIP', schema: z.object({ orderId: id }).strict() },
  { operation: 'ORDER_RECEIVE', schema: z.object({ orderId: id }).strict() },
  ...BUSINESS_OPERATIONS.map((d) => ({
    operation: d.kind,
    schema: d.kind === 'MEMBER_TIER' ? d.schema.extend({ memberId: id.optional() }) : d.schema,
  })),
  ...CATALOG_OPERATIONS.map((d) => ({ operation: d.kind, schema: d.schema })),
] as const;
const operationSchemas = BATCH_OPERATIONS.map((d) =>
  z.object({ operation: z.literal(d.operation), input: d.schema }).strict(),
);
export const batchOperationsSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    memberSelectionId: id.optional(),
    productSelectionId: id.optional(),
    items: z
      .array(
        z.discriminatedUnion(
          'operation',
          operationSchemas as [
            (typeof operationSchemas)[number],
            ...(typeof operationSchemas)[number][],
          ],
        ),
      )
      .min(1)
      .max(20),
  })
  .strict();

type Child = {
  actionId: string;
  payloadHash: string;
  kind: string;
  label: string;
  payload: Record<string, unknown>;
};
export type BatchOperationsPayload = {
  batchKey: string;
  batchOperations: { title: string; simulated?: boolean; rows: Child[] };
};
type ResultRow = { actionId: string; status: string; message?: string; result?: unknown };
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export class BatchOperations {
  constructor(private readonly db: PrismaService) {}
  async preview(
    user: AuthUser,
    ctx: ExecutionContext,
    input: unknown,
    state: MemberState,
    prepare: (
      ctx: ExecutionContext,
      operation: string,
      input: unknown,
      state: MemberState,
    ) => Promise<{ action: AgentAction }>,
    draft: (ctx: ExecutionContext, payload: BatchOperationsPayload) => Promise<AgentAction>,
    simulated = false,
  ) {
    const args = batchOperationsSchema.parse(input);
    if (!user.permissions.includes('dashboard:view'))
      throw new ForbiddenException('缺少运营助手权限');
    if (!user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('批量编排需要ALL范围');
    const selection = args.memberSelectionId ? state.memberSelection : undefined;
    if (args.memberSelectionId && selection?.id !== args.memberSelectionId)
      throw new ConflictException('会员集合已变化，请重新选择');
    const products = args.productSelectionId ? state.productSelection : undefined;
    if (args.productSelectionId && products?.id !== args.productSelectionId)
      throw new ConflictException('商品集合已变化，请重新选择');
    const expanded: { operation: string; input: Record<string, unknown> }[] = [];
    for (const item of args.items) {
      const data = item.input as Record<string, unknown>;
      const memberScoped = ['MEMBER_EDIT', 'MEMBER_TIER', 'COUPON_VOID', 'ORDER_CREATE'].includes(
        item.operation,
      );
      const productScoped = ['PRODUCT_EDIT', 'PRODUCT_STOCK'].includes(item.operation);
      if (productScoped && !data.productId && !products)
        throw new BadRequestException('请明确商品或先选择商品集合');
      if (
        productScoped &&
        products &&
        data.productId &&
        !products.products.some((p) => p.id === data.productId)
      )
        throw new BadRequestException('商品不属于已选集合');
      if (memberScoped && !selection) throw new BadRequestException('请先选择批量会员集合');
      if (memberScoped && data.memberId && !selection!.members.some((m) => m.id === data.memberId))
        throw new BadRequestException('会员不属于已选名单');
      if (productScoped && !data.productId) {
        expanded.push(
          ...products!.products.map((p) => ({
            operation: item.operation,
            input: { ...data, productId: p.id },
          })),
        );
      } else if (item.operation === 'COUPON_ISSUE') {
        if (!selection) throw new BadRequestException('请先选择发券会员集合');
        const ids = (data.memberIds as string[] | undefined) || selection.members.map((m) => m.id);
        if (ids.some((id) => !selection.members.some((m) => m.id === id)))
          throw new BadRequestException('发券对象不属于已选名单');
        expanded.push({ operation: item.operation, input: { ...data, memberIds: ids } });
      } else if (memberScoped && !data.memberId) {
        expanded.push(
          ...selection!.members.map((m) => ({
            operation: item.operation,
            input: { ...data, memberId: m.id },
          })),
        );
      } else expanded.push({ operation: item.operation, input: data });
    }
    if (expanded.length > 20) throw new BadRequestException('单批最多20项业务操作，请缩小范围');
    const targets = expanded.map(
      (i) =>
        i.operation +
        ':' +
        ([
          i.input.couponId,
          i.input.productId,
          i.input.memberId,
          i.input.orderId,
          i.input.templateId,
          i.input.id,
          i.input.phone,
        ].find((v): v is string => typeof v === 'string') || randomUUID()),
    );
    if (new Set(targets).size !== targets.length)
      throw new BadRequestException('同一对象的相同操作请合并为一项，避免互相覆盖');
    const batchKey = randomUUID();
    const childCtx = { ...ctx, batchParentKey: batchKey };
    const rows: Child[] = [];
    try {
      for (const item of expanded) {
        const rowState = {
          ...state,
          ...(typeof item.input.memberId === 'string'
            ? { selectedMemberId: item.input.memberId }
            : {}),
        };
        const { action } = await prepare(childCtx, item.operation, item.input, rowState);
        rows.push({
          actionId: action.id,
          payloadHash: action.payloadHash,
          kind: action.kind,
          label: item.operation,
          payload: action.payload as Record<string, unknown>,
        });
      }
      const action = await draft(ctx, {
        batchKey,
        batchOperations: { title: args.title, ...(simulated ? { simulated: true } : {}), rows },
      });
      return {
        ok: true,
        action,
        definition:
          '仅生成完整批量预览。一次确认授权列出的固定操作；权限、原业务规则逐项复核，成功项不重发，部分失败如实展示，不替换对象。',
      };
    } catch (error) {
      await this.db.agentAction.updateMany({
        where: {
          userId: user.id,
          id: { in: rows.map((r) => r.actionId) },
          status: 'WAITING_CONFIRMATION',
        },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      throw error;
    }
  }
  async generatedInput(input: unknown) {
    const args = generatedMembersSchema.parse(input);
    const phones = new Set<string>();
    while (phones.size < args.count) {
      const phone = '000' + String(randomInt(100000000)).padStart(8, '0');
      if (!(await this.db.member.findUnique({ where: { phone } }))) phones.add(phone);
    }
    return {
      title: `生成${args.count}位模拟会员`,
      items: [...phones].map((phone, i) => ({
        operation: 'MEMBER_CREATE',
        input: { name: `${args.namePrefix}（模拟）${i + 1}-${randomUUID().slice(0, 4)}`, phone },
      })),
    };
  }
  async execute(
    user: AuthUser,
    action: AgentAction,
    confirm: (
      user: AuthUser,
      id: string,
      input: unknown,
      parent: AgentAction,
    ) => Promise<AgentAction>,
  ) {
    const payload = action.payload as unknown as BatchOperationsPayload;
    const saved = action.result as { rows?: ResultRow[] } | null;
    const rows: ResultRow[] =
      saved?.rows ||
      payload.batchOperations.rows.map((r) => ({ actionId: r.actionId, status: 'PENDING' }));
    const outcome = () => ({
      status: rows.some((r) => ['PENDING', 'UNKNOWN', 'EXECUTING'].includes(r.status))
        ? 'IN_PROGRESS'
        : rows.some((r) => r.status === 'FAILED')
          ? 'PARTIAL_FAILED'
          : 'ALL_SUCCEEDED',
      succeeded: rows.filter((r) => r.status === 'SUCCEEDED').length,
      failed: rows.filter((r) => r.status === 'FAILED').length,
      pending: rows.filter((r) => !['SUCCEEDED', 'FAILED'].includes(r.status)).length,
      rows,
    });
    const checkpoint = async () => {
      const changed = await this.db.agentAction.updateMany({
        where: { id: action.id, status: 'EXECUTING', version: action.version + 1 },
        data: { result: json(outcome()), leaseUntil: new Date(Date.now() + 120000) },
      });
      if (!changed.count) throw new ConflictException('批次执行权已变化');
    };
    for (const [index, row] of payload.batchOperations.rows.entries()) {
      if (['SUCCEEDED', 'FAILED'].includes(rows[index].status)) continue;
      await checkpoint();
      const fresh = await freshBatchUser(this.db, user);
      if (!fresh.roles.some((r) => r.dataScope === 'ALL'))
        throw new ForbiddenException('批量业务数据范围已变化，请先核对原批次');
      const child = await this.db.agentAction.findUniqueOrThrow({ where: { id: row.actionId } });
      try {
        const result = await confirm(
          fresh,
          child.id,
          { decision: 'APPROVE', expectedVersion: child.version, expectedHash: child.payloadHash },
          action,
        );
        rows[index] = { actionId: child.id, status: result.status, result: result.result };
      } catch (error) {
        const current = await this.db.agentAction.findUniqueOrThrow({ where: { id: child.id } });
        const known =
          current.status === 'FAILED' ||
          (current.status === 'WAITING_CONFIRMATION' &&
            error instanceof HttpException &&
            error.getStatus() >= 400 &&
            error.getStatus() < 500);
        rows[index] = {
          actionId: child.id,
          status: known ? 'FAILED' : 'UNKNOWN',
          message: toolError(error).message,
          result: current.result,
        };
      }
      await checkpoint();
      if (!['SUCCEEDED', 'FAILED'].includes(rows[index].status))
        throw new Error('批次包含结果待核对项目，请恢复原批次');
    }
    return outcome();
  }
}
export async function freshBatchUser(db: PrismaService, user: AuthUser): Promise<AuthUser> {
  const fresh = await db.user.findUnique({
    where: { id: user.id },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!fresh?.enabled) throw new ForbiddenException('账号已停用');
  const current = {
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
  if (!current.permissions.includes('dashboard:view'))
    throw new ForbiddenException('运营助手权限已撤销');
  return current;
}
export async function topLevelActionIds(
  db: PrismaService | Prisma.TransactionClient,
  userId: string,
  conversationId: string,
  runId = '',
) {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AgentAction"
    WHERE "userId"=${userId} AND "conversationId"=${conversationId}
    AND (${runId}='' OR "runId"=${runId}) AND "payload"->>'batchParentKey' IS NULL
    ORDER BY "createdAt" DESC LIMIT 20`;
  return rows.map((r) => r.id);
}
