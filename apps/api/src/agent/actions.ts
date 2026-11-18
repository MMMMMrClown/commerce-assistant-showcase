import { memberCreateSchema, quoteSchema, seckillSchema } from './commerce-schemas';
import { queryProductSales, queryCommerceRecords } from './commerce-queries';
export { memberCreateSchema, quoteSchema, seckillSchema } from './commerce-schemas';
import { transactionService } from './transaction-service';
import { BatchOrders } from './batch-orders';
import {
  BatchOperations,
  productStockSchema,
  topLevelActionIds,
  type BatchOperationsPayload,
} from './batch-operations';
import { adjustStock } from '../orders/product-stock';
import { ProductsService } from '../modules/resources';
import { ProductDto, UpdateProductDto } from '../modules/product.dto';
import { DataScopeService } from '../auth/auth';
import { fulfillmentView, inventoryView } from './commerce-read-model';
import { toolError } from './tool-error';
import { HttpException } from '@nestjs/common';
import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BusinessOperations } from './business-operations';
import { productEditSchema, memberEditSchema } from './commerce-schemas';
import {
  couponTemplateUpdateSchema,
  couponTemplateDisableSchema,
  couponVoidSchema,
} from './commerce-schemas';
import { UpdateCouponTemplateDto } from '../coupons/coupon.dto';
import { CatalogOperations, CATALOG_OPERATIONS } from './catalog-operations';
import { productCreateSchema, productRenameSchema } from './commerce-schemas';
import { CouponsService } from '../coupons/coupons.service';
import { CreateCouponTemplateDto, BatchIssueCouponDto } from '../coupons/coupon.dto';
import { couponTemplateSchema, couponIssueSchema, seckillToggleSchema } from './commerce-schemas';
import { SeckillService } from '../seckill/seckill.service';
import { CreateSeckillDto } from '../seckill/seckill.dto';
import { MembersService } from '../members/members.service';
import { CreateMemberDto, UpdateMemberDto } from '../members/member.dto';
import { MemberBenefitsService } from '../member-benefits/member-benefits.service';
import { maskPhone } from './member-tools';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../common/api';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateOrderDto, QuoteOrderDto, ListOrdersDto } from '../orders/order.dto';
import { RequestRefundDto } from '../payments/payment.dto';
import type { MemberState } from './member-tools';

export type ExecutionContext = {
  batchParentKey?: string;
  allowSuggestedSeckill?: boolean;
  replacesAction?: { id: string; hash: string; version: number };
  entities?: MemberState;
  taskLink?: { planId: string; field: 'templateActionId' | 'issueActionId' };
  conversationId: string;
  runId: string;
  credential: string;
  leaseToken?: string;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const catalogSchema = z
  .object({
    keyword: z.string().max(100).default(''),
    page: z.number().int().min(1).max(100).default(1),
  })
  .strict();
export const productCatalogSchema = catalogSchema.extend({
  state: z.enum(['all', 'warning', 'recycled']).optional(),
  enabled: z.boolean().optional(),
  categoryId: z.string().min(1).max(100).optional(),
});
export const stockMovementSchema = z
  .object({
    productId: z.string().min(1).max(100),
    page: z.number().int().min(1).max(100).default(1),
  })
  .strict();
export const searchOrdersSchema = z
  .object({
    keyword: z.string().max(100).optional(),
    productKeyword: z.string().trim().min(1).max(100).optional(),
    storeKeyword: z.string().trim().min(1).max(100).optional(),
    source: z.enum(['LEGACY', 'CSV_IMPORT', 'BACKOFFICE']).optional(),
    storeId: z.string().min(1).max(100).optional(),
    status: z.enum(['PENDING_PAYMENT', 'PAID', 'COMPLETED', 'CANCELED', 'REFUNDED']).optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    page: z.number().int().min(1).max(100).default(1),
    pageSize: z.number().int().min(1).max(20).default(10),
  })
  .strict();
export const orderIdSchema = z.object({ orderId: z.string().min(1).max(100) }).strict();
export const memberRenameSchema = z
  .object({ memberId: z.string().min(1).max(100), name: z.string().trim().min(1).max(80) })
  .strict();
export const refundSchema = orderIdSchema
  .extend({ reason: z.string().trim().min(2).max(200) })
  .strict();
export const confirmSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    expectedVersion: z.number().int().min(0),
    expectedHash: z.string().length(64),
  })
  .strict();
export const seckillProposalSchema = seckillSchema
  .extend({ rationale: z.string().trim().min(10).max(1200) })
  .strict();
export const reviseSeckillSchema = z
  .object({
    expectedHash: z.string().length(64),
    expectedVersion: z.number().int().min(0),
    changes: seckillSchema.partial().refine((v) => Object.keys(v).length > 0, '至少修改一项'),
  })
  .strict();

@Injectable()
export class AgentActions implements OnModuleInit, OnModuleDestroy {
  private auditTimer?: ReturnType<typeof setInterval>;
  onModuleInit() {
    this.auditTimer = setInterval(() => {
      void this.flushAudit().catch(() => undefined);
    }, 30000);
    this.auditTimer.unref();
  }
  onModuleDestroy() {
    if (this.auditTimer) clearInterval(this.auditTimer);
  }
  constructor(
    private readonly db: PrismaService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
    private readonly members: MembersService,
    private readonly benefits: MemberBenefitsService,
  ) {}
  // 【会员预览】只开放新增和姓名修改；手机号、等级、积分、消费额不在修改白名单。
  async prepareMember(
    user: AuthUser,
    ctx: ExecutionContext,
    input: unknown,
    state: MemberState,
    create: boolean,
  ) {
    this.permission(user, 'member:view', create ? 'member:create' : 'member:edit');
    if (!user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('会员管理需要ALL数据范围');
    const args = create ? memberCreateSchema.parse(input) : memberRenameSchema.parse(input);
    let before: { name: string; maskedPhone: string; updatedAt: string } | undefined;
    if ('phone' in args) {
      const found = await this.members.list({ keyword: args.phone, pageSize: '100' });
      if (found.items.some((m) => m.phone === args.phone))
        throw new ConflictException('该手机号已存在，请查询现有会员；不会自动覆盖资料');
    } else {
      if (state.selectedMemberId !== args.memberId)
        throw new BadRequestException('请先搜索并选择要修改的会员');
      const m = await this.members.detail(args.memberId);
      if (m.name === args.name) throw new BadRequestException('新姓名与当前相同，无需修改');
      before = {
        name: m.name,
        maskedPhone: maskPhone(m.phone),
        updatedAt: m.updatedAt.toISOString(),
      };
    }
    const draft = await this.db.agentDraft.create({
      data: {
        userId: user.id,
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        input: json(args),
        quote: {},
        quoteHash: digest(args),
        expiresAt: new Date(Date.now() + 120000),
      },
    });
    const visible =
      'phone' in args ? { name: args.name, maskedPhone: maskPhone(args.phone) } : args;
    return {
      ok: true,
      action: await this.draftAction(
        user,
        ctx,
        create ? 'CREATE_MEMBER' : 'RENAME_MEMBER',
        { input: visible, before },
        draft.id,
      ),
      definition:
        '仅预览，需人工点击确认。原始手机号只保存在执行草稿，不返回工具结果。修改姓名会在提交前复读；原业务接口没有跨后台操作的版本CAS保证。',
    };
  }
  private permission(user: AuthUser, ...codes: string[]) {
    if (!codes.every((c) => user.permissions.includes(c)))
      throw new ForbiddenException('没有执行此业务的权限');
  }
  database() {
    return this.db;
  }
  async searchOrders(user: AuthUser, input: unknown) {
    this.permission(user, 'order:view');
    const args = searchOrdersSchema.parse(input);
    if (args.startDate && args.endDate && args.startDate > args.endDate)
      throw new BadRequestException('日期范围无效');
    const dto = plainToInstance(ListOrdersDto, args);
    const r = await this.orders.list(user, dto);
    return {
      ok: true,
      total: r.total,
      page: r.page,
      pageSize: r.pageSize,
      statusCounts: r.statusCounts,
      items: r.items.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        orderedAt: o.orderedAt,
        status: o.status,
        ...fulfillmentView(o),
        store: o.store.name,
        payableAmount: o.payableAmount,
        paidAmount: o.paidAmount,
        source: o.source,
        items: o.items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          productCode: item.productCode,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toFixed(2),
          subtotal: item.subtotal.toFixed(2),
        })),
      })),
      definition:
        '订单按当前账号门店范围查询；查询手机号/会员姓名须先经会员查询与消歧，不能使用订单列表绕过会员权限。',
    };
  }
  async commerceQuery(
    user: AuthUser,
    ctx: ExecutionContext,
    key: string,
    input: unknown,
    state: MemberState,
  ) {
    return key === 'query_product_sales'
      ? queryProductSales(this.db, user, input)
      : queryCommerceRecords(this.config, user, ctx.credential, key, input, state);
  }
  async businessQuery(user: AuthUser, ctx: ExecutionContext, key: string, input: unknown) {
    return new BusinessOperations(this.config).query(user, ctx.credential, key, input);
  }
  async prepareBusiness(
    user: AuthUser,
    ctx: ExecutionContext,
    kind: string,
    input: unknown,
    state: MemberState,
  ) {
    if (
      kind === 'MEMBER_TIER' &&
      (input as { memberId?: string }).memberId !== state.selectedMemberId
    )
      throw new BadRequestException('请先查询并选择要调整等级的会员');
    const { execution, ...payload } = await new BusinessOperations(this.config).preview(
      user,
      ctx.credential,
      kind,
      input,
    );
    void execution; // 固定执行路由和请求体不进入模型结果或普通业务确认卡。
    return {
      ok: true,
      action: await this.draftAction(user, ctx, kind, payload),
      definition: payload.definition,
    };
  }
  async prepareMemberEdit(
    user: AuthUser,
    ctx: ExecutionContext,
    input: unknown,
    state: MemberState,
  ) {
    this.permission(user, 'member:view', 'member:edit');
    if (!user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('会员管理需要ALL范围');
    const args = memberEditSchema.parse(input);
    if (state.selectedMemberId !== args.memberId)
      throw new BadRequestException('请先搜索并选择要修改的会员');
    const current = await this.members.detail(args.memberId);
    const fields = Object.entries(args.changes)
      .filter(([k, v]) => current[k as keyof typeof args.changes] !== v)
      .map(([k, v]) => ({
        label: { name: '姓名', phone: '手机号', enabled: '会员启用状态' }[k],
        before: k === 'phone' ? maskPhone(current.phone) : current[k as keyof typeof args.changes],
        after: k === 'phone' ? maskPhone(String(v)) : v,
      }));
    if (!fields.length && !ctx.batchParentKey) throw new BadRequestException('资料相同，无需修改');
    if (args.changes.phone) {
      const found = await this.members.list({ keyword: args.changes.phone, pageSize: '100' });
      if (found.items.some((m) => m.phone === args.changes.phone && m.id !== args.memberId))
        throw new ConflictException('该手机号已存在，不会覆盖其他会员');
    }
    const draft = await this.db.agentDraft.create({
      data: {
        userId: user.id,
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        input: json(args),
        quote: {},
        quoteHash: digest(args),
        expiresAt: new Date(Date.now() + 120000),
      },
    });
    return {
      ok: true,
      action: await this.draftAction(
        user,
        ctx,
        'EDIT_MEMBER',
        {
          fields,
          ...(!fields.length ? { noChange: true } : {}),
          summary: { name: current.name },
          before: { updatedAt: current.updatedAt.toISOString() },
        },
        draft.id,
      ),
      definition:
        '仅修改差异卡字段；停用后不可新建订单。手机号只在执行草稿保存完整值，提交前复读资料。',
    };
  }
  async prepareProductEdit(user: AuthUser, ctx: ExecutionContext, input: unknown) {
    this.permission(user, 'product:view', 'product:edit');
    if (!user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('商品管理需要ALL范围');
    const args = productEditSchema.parse(input);
    const current = await this.productApi(
      ctx.credential,
      'products/' + encodeURIComponent(args.productId),
    );
    if (!current || current.deletedAt) throw new NotFoundException('商品不存在');
    if (args.changes.categoryId) {
      this.permission(user, 'product-category:view');
      const categories = await this.productApi(ctx.credential, 'product-categories');
      if (
        !(categories as unknown as { id: string; enabled: boolean }[]).some(
          (c) => c.id === args.changes.categoryId && c.enabled,
        )
      )
        throw new BadRequestException('分类不存在或已停用');
    }
    const fields = Object.entries(args.changes)
      .filter(([k, v]) =>
        ['price', 'costPrice'].includes(k) ? Number(current[k]) !== Number(v) : current[k] !== v,
      )
      .map(([k, v]) => ({
        label: {
          name: '商品名称',
          code: '商品编号',
          imageUrl: '商品图片地址',
          categoryId: '分类编号',
          price: '售价',
          costPrice: '成本',
          enabled: '商品上架状态',
        }[k],
        before: current[k],
        after: v,
      }));
    if (!fields.length && !ctx.batchParentKey) throw new BadRequestException('资料相同，无需修改');
    return {
      ok: true,
      action: await this.draftAction(user, ctx, 'PRODUCT_EDIT', {
        input: args,
        fields,
        ...(!fields.length ? { noChange: true } : {}),
        summary: { name: current.name },
        before: { updatedAt: current.updatedAt },
      }),
      definition:
        '仅修改差异字段；调价影响后续报价，已创建订单保留原快照。提交前复读，不承诺原接口没有的强并发版本控制。',
    };
  }
  async prepareCatalog(user: AuthUser, ctx: ExecutionContext, kind: string, input: unknown) {
    const payload = await new CatalogOperations(this.config).preview(
      user,
      ctx.credential,
      kind,
      input,
    );
    return {
      ok: true,
      action: await this.draftAction(user, ctx, kind, payload),
      definition: '仅资料预览，需人工确认',
    };
  }
  async regions(user: AuthUser, ctx: ExecutionContext) {
    return new CatalogOperations(this.config).regions(user, ctx.credential);
  }
  async managementLookup(user: AuthUser, ctx: ExecutionContext, key: string, input: unknown) {
    const args = catalogSchema.parse(input);
    return new CatalogOperations(this.config).lookup(
      user,
      ctx.credential,
      key,
      args.keyword,
      args.page,
    );
  }
  // 【固定商品接口】模型不能传URL/方法，创建与普通字段编辑复用原HTTP鉴权和DTO管道。
  private async productApi(credential: string, path: string, method = 'GET', data?: unknown) {
    if (!credential) throw new ForbiddenException('缺少当前登录凭据');
    const response = await fetch(
      `http://127.0.0.1:${this.config.get('PORT', 3200)}/api/v1/${path}`,
      {
        method,
        headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}),
        signal: AbortSignal.timeout(15000),
      },
    );
    const body = (await response.json()) as { data: Record<string, unknown>; message?: string };
    if (!response.ok) {
      if (response.status === 403 || response.status === 401)
        throw new ForbiddenException('当前账号没有商品操作权限');
      if (response.status < 500) throw new HttpException(body, response.status);
      throw new Error('商品服务暂不可用');
    }
    return body.data;
  }
  async productCategories(user: AuthUser, ctx: ExecutionContext) {
    this.permission(user, 'product-category:view');
    return { ok: true, items: await this.productApi(ctx.credential, 'product-categories') };
  }
  async prepareProduct(user: AuthUser, ctx: ExecutionContext, input: unknown, create: boolean) {
    this.permission(user, 'product:view', create ? 'product:create' : 'product:edit');
    if (!user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('商品管理需要ALL范围');
    const args = create ? productCreateSchema.parse(input) : productRenameSchema.parse(input);
    let before: unknown;
    if ('productId' in args) {
      const current = await this.productApi(
        ctx.credential,
        'products/' + encodeURIComponent(args.productId),
      );
      if (!current || current.deletedAt) throw new NotFoundException('商品不存在');
      if (current.name === args.name) throw new BadRequestException('名称相同，无需修改');
      before = { name: current.name, updatedAt: current.updatedAt };
    } else {
      const found = await this.productApi(
        ctx.credential,
        'products?keyword=' + encodeURIComponent(args.code) + '&pageSize=100',
      );
      if ((found.items as { code: string }[]).some((p) => p.code === args.code))
        throw new ConflictException('商品编号已存在，请查询原商品');
    }
    return {
      ok: true,
      action: await this.draftAction(user, ctx, create ? 'PRODUCT_CREATE' : 'PRODUCT_RENAME', {
        input: args,
        before,
      }),
      definition: '仅预览；通过原商品接口执行。结果未知不会自动重新创建，需要人工核对。',
    };
  }
  // 【营销预览】模板和发券分开确认，收件会员集合冻结，不接受动态全员发放。
  async prepareCommerce(
    user: AuthUser,
    ctx: ExecutionContext,
    kind: 'COUPON_TEMPLATE_CREATE' | 'COUPON_ISSUE' | 'SECKILL_TOGGLE',
    input: unknown,
  ) {
    this.permission(
      user,
      ...(kind === 'SECKILL_TOGGLE' ? ['seckill:manage'] : ['member:view', 'member:coupon-issue']),
    );
    if (!user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('全平台营销管理需要ALL范围');
    const coupons = new CouponsService(this.db);
    let payload: unknown;
    if (kind === 'COUPON_TEMPLATE_CREATE') {
      const args = couponTemplateSchema.parse(input);
      if (
        Number(args.minimumSpend) <= 0 ||
        Number(args.discountAmount) <= 0 ||
        Number(args.discountAmount) > Number(args.minimumSpend) ||
        new Date(args.startsAt) >= new Date(args.endsAt) ||
        new Date(args.endsAt) <= new Date()
      )
        throw new BadRequestException('满减金额或有效期不正确，请明确起止时间');
      const dto = plainToInstance(CreateCouponTemplateDto, args);
      await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
      payload = {
        input: args,
        summary: args,
        definition: '仅创建满减券模板，不自动发券或叠加会员折扣',
      };
    } else if (kind === 'COUPON_ISSUE') {
      const args = couponIssueSchema.parse(input);
      args.memberIds = [...new Set(args.memberIds)].sort();
      const template = (await coupons.templates()).find((t) => t.id === args.templateId);
      if (!template || template.endsAt <= new Date())
        throw new BadRequestException('券模板不存在或已过期');
      const members = await Promise.all(args.memberIds.map((id) => this.members.detail(id)));
      if (members.some((m) => !m.enabled))
        throw new BadRequestException('目标包含停用会员，请重新选择');
      payload = {
        input: args,
        templateVersion: template.version,
        summary: {
          templateName: template.name,
          minimumSpend: template.minimumSpend.toFixed(2),
          discountAmount: template.discountAmount.toFixed(2),
          startsAt: template.startsAt,
          endsAt: template.endsAt,
          recipients: members.map((m) => ({
            id: m.id,
            name: m.name,
            maskedPhone: maskPhone(m.phone),
          })),
          count: members.length,
        },
      };
    } else {
      const args = seckillToggleSchema.parse(input);
      const activity = (await new SeckillService(this.db, this.orders).list()).find(
        (a) => a.id === args.activityId,
      );
      if (!activity) throw new NotFoundException('秒杀活动不存在');
      if (activity.enabled === args.enabled)
        throw new BadRequestException('活动已处于目标状态，无需重复操作');
      payload = {
        input: args,
        before: { enabled: activity.enabled },
        summary: {
          name: activity.name,
          product: activity.product.name,
          enabled: args.enabled,
          remainingStock: activity.remainingStock,
        },
        definition: '停用只停止新报价和新下单，已创建订单仍按原截止时间处理',
      };
    }
    return {
      ok: true,
      action: await this.draftAction(user, ctx, kind, payload),
      definition: '仅预览，尚未执行，需点击确认卡',
    };
  }
  async couponTemplates(user: AuthUser) {
    this.permission(user, 'member:view', 'member:coupon-issue');
    if (!user.roles.some((r) => r.dataScope === 'ALL')) throw new ForbiddenException('需要ALL范围');
    return {
      ok: true,
      items: (await new CouponsService(this.db).templates()).slice(0, 100),
      definition: '模板不会自动发放；选择明确会员后另行准备发券卡',
    };
  }
  // 【券生命周期】模板修改发布新版本，停发不删除旧券，作废须确认具体归属。
  async prepareCouponChange(
    user: AuthUser,
    ctx: ExecutionContext,
    kind: 'COUPON_TEMPLATE_UPDATE' | 'COUPON_TEMPLATE_DISABLE' | 'COUPON_VOID',
    input: unknown,
  ) {
    this.permission(user, 'member:view', 'member:coupon-issue');
    if (!user.roles.some((r) => r.dataScope === 'ALL')) throw new ForbiddenException('需要ALL范围');
    const service = new CouponsService(this.db);
    let payload: unknown;
    if (kind === 'COUPON_VOID') {
      const args = couponVoidSchema.parse(input);
      const member = await this.members.detail(args.memberId);
      const coupon = (await service.list(args.memberId)).find((c) => c.id === args.couponId);
      if (!coupon || coupon.status !== 'AVAILABLE')
        throw new BadRequestException('会员券不存在、已占用、已核销或已作废，不能准备作废');
      payload = {
        input: args,
        summary: {
          name: coupon.template.name,
          minimumSpend: coupon.template.minimumSpend,
          discountAmount: coupon.template.discountAmount,
          startsAt: coupon.template.startsAt,
          endsAt: coupon.template.endsAt,
          recipients: [{ id: member.id, name: member.name, maskedPhone: maskPhone(member.phone) }],
          count: 1,
        },
        fields: [
          {
            label: '持有人',
            before: `${member.name} ${maskPhone(member.phone)}`,
            after: `${member.name} ${maskPhone(member.phone)}`,
          },
          { label: '会员券编号', before: coupon.id, after: coupon.id },
          { label: '会员券状态', before: coupon.status, after: 'VOID' },
        ],
        definition: '只作废该会员的这张券，不删除模板或其他会员券',
      };
    } else {
      const args =
        kind === 'COUPON_TEMPLATE_UPDATE'
          ? couponTemplateUpdateSchema.parse(input)
          : couponTemplateDisableSchema.parse(input);
      const template = (await service.templates()).find((t) => t.id === args.templateId);
      if (!template) throw new NotFoundException('模板不存在或已停发');
      const before = {
        name: template.name,
        minimumSpend: template.minimumSpend.toFixed(2),
        discountAmount: template.discountAmount.toFixed(2),
        startsAt: template.startsAt.toISOString(),
        endsAt: template.endsAt.toISOString(),
      };
      const changes =
        kind === 'COUPON_TEMPLATE_UPDATE'
          ? couponTemplateUpdateSchema.parse(input).changes
          : undefined;
      const merged = changes ? { ...before, ...changes } : before;
      if (
        changes &&
        (Number(merged.minimumSpend) <= 0 ||
          Number(merged.discountAmount) <= 0 ||
          Number(merged.discountAmount) > Number(merged.minimumSpend) ||
          new Date(merged.startsAt) >= new Date(merged.endsAt) ||
          new Date(merged.endsAt) <= new Date())
      )
        throw new BadRequestException('满减规则或有效期不正确，请调整后重新预览');
      const fields = changes
        ? Object.entries(changes).map(([key, value]) => ({
            label: (
              {
                name: '名称',
                minimumSpend: '使用门槛',
                discountAmount: '优惠金额',
                startsAt: '开始时间',
                endsAt: '结束时间',
              } as Record<string, string>
            )[key],
            before: before[key as keyof typeof before],
            after: value,
          }))
        : [{ label: '发放状态', before: '可发放', after: '停止后续发放' }];
      payload = {
        input: { templateId: template.id, ...merged, version: template.version },
        before,
        summary: merged,
        fields,
        definition:
          kind === 'COUPON_TEMPLATE_UPDATE'
            ? '确认后创建替代新版本，原模板停止后续发放；已发券保持旧规则，不自动发新券'
            : '只停止后续发券，已发券及历史规则保留',
      };
    }
    return {
      ok: true,
      action: await this.draftAction(user, ctx, kind, payload),
      definition: '仅预览，需单独确认',
    };
  }
  // 【固定路由读取】只使用当前请求认证信息，模型不能指定URL或服务账号；响应显式裁剪。
  async catalog(
    user: AuthUser,
    ctx: ExecutionContext,
    kind: 'products' | 'stores' | 'coupons' | 'seckill',
    input: unknown,
    state: MemberState,
  ) {
    const args: z.infer<typeof productCatalogSchema> =
      kind === 'products' ? productCatalogSchema.parse(input) : catalogSchema.parse(input);
    const permission = {
      products: 'product:view',
      stores: 'store:view',
      coupons: 'member:view',
      seckill: 'seckill:view',
    }[kind];
    this.permission(user, permission);
    if (kind === 'coupons' && !state.selectedMemberId)
      throw new BadRequestException('请先选择会员');
    if (kind === 'coupons' && !user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('全平台会员券仅供ALL管理者查看');
    if (!ctx.credential) throw new ForbiddenException('缺少当前身份凭据');
    const path =
      kind === 'coupons'
        ? '/coupons/members/' + encodeURIComponent(state.selectedMemberId!)
        : kind === 'seckill'
          ? '/seckill/activities'
          : '/' + kind;
    const response = await fetch(
      'http://127.0.0.1:' +
        this.config.get('PORT', 3200) +
        '/api/v1' +
        path +
        '?' +
        new URLSearchParams({
          keyword: args.keyword,
          page: String(args.page),
          pageSize: '10',
          ...(kind === 'products' && 'state' in args && args.state ? { state: args.state } : {}),
          ...(kind === 'products' && 'enabled' in args && args.enabled !== undefined
            ? { enabled: String(args.enabled) }
            : {}),
          ...(kind === 'products' && 'categoryId' in args && args.categoryId
            ? { categoryId: args.categoryId }
            : {}),
        }).toString(),
      {
        headers: { Authorization: 'Bearer ' + ctx.credential },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new BadRequestException('业务读取失败：' + response.status);
    const body = (await response.json()) as {
      data: { items?: Record<string, unknown>[]; total?: number } | Record<string, unknown>[];
    };
    const filtered = Array.isArray(body.data)
      ? body.data.filter((r) =>
          [
            r.id,
            r.name,
            (r.product as { name?: string } | undefined)?.name,
            (r.template as { name?: string } | undefined)?.name,
          ].some(
            (v) => typeof v === 'string' && v.toLowerCase().includes(args.keyword.toLowerCase()),
          ),
        )
      : null;
    const rows = Array.isArray(body.data)
      ? (filtered || []).slice((args.page - 1) * 10, args.page * 10)
      : body.data.items || [];
    return {
      ok: true,
      page: args.page,
      total: filtered ? filtered.length : (body.data as { total?: number }).total,
      pageSize: 10,
      items: rows.map((r) =>
        kind === 'products'
          ? {
              id: r.id,
              name: r.name,
              code: r.code,
              price: r.price,
              salesQuantity: r.salesQuantity,
              salesQuantityDefinition:
                '截至查询时PAID+COMPLETED净成交件数，按账号订单范围；未按近期日期筛选，近期销量应查query_product_sales。',
              ...inventoryView(r),
              enabled: r.enabled,
              category: r.category && {
                id: (r.category as { id: string }).id,
                name: (r.category as { name: string }).name,
                enabled: (r.category as { enabled: boolean }).enabled,
              },
            }
          : kind === 'stores'
            ? { id: r.id, name: r.name, code: r.code, enabled: r.enabled }
            : kind === 'seckill'
              ? {
                  id: r.id,
                  name: r.name,
                  productId: r.productId,
                  price: r.price,
                  remainingStock: r.remainingStock,
                  stock: r.stock,
                  holdMinutes: r.holdMinutes,
                  product: r.product,
                  startsAt: r.startsAt,
                  endsAt: r.endsAt,
                  enabled: r.enabled,
                }
              : {
                  id: r.id,
                  status: r.status,
                  displayStatus: r.displayStatus,
                  template: r.template,
                },
      ),
      definition:
        '目录与库存为查询时快照，报价和提交仍复核；可售=现存−占用。库存未初始化不能当作0，秒杀名额独立于商品库存。',
    };
  }
  async stockMovements(user: AuthUser, ctx: ExecutionContext, input: unknown) {
    this.permission(user, 'product:view');
    const args = stockMovementSchema.parse(input);
    const data = await this.productApi(
      ctx.credential,
      `products/${encodeURIComponent(args.productId)}/stock-movements?page=${args.page}`,
    );
    const rows = (data.items || []) as Record<string, unknown>[];
    return {
      ok: true,
      page: data.page,
      pageSize: data.pageSize,
      total: data.total,
      items: rows.map((r) =>
        Object.fromEntries(
          [
            'id',
            'productId',
            'kind',
            'createdAt',
            'quantity',
            'beforeOnHand',
            'afterOnHand',
            'beforeReserved',
            'afterReserved',
          ].map((k) => [k, r[k]]),
        ),
      ),
      definition: '只读库存流水，不调整库存；占用与现存分别记录。',
    };
  }
  // 【活动预览】发布参数必须由运营人员明确，确认前不创建活动。
  async prepareSeckill(
    user: AuthUser,
    ctx: ExecutionContext,
    input: unknown,
    proposal?: { rationale: string; basis: string },
  ) {
    this.permission(user, 'seckill:manage', 'product:view');
    const args = seckillSchema.parse(input);
    if (
      Number(args.price) <= 0 ||
      new Date(args.startsAt) >= new Date(args.endsAt) ||
      new Date(args.endsAt) <= new Date()
    )
      throw new BadRequestException('活动价格或起止时间不正确');
    const dto = plainToInstance(CreateSeckillDto, args);
    await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
    const product = await this.db.product.findFirst({
      where: { id: args.productId, enabled: true, deletedAt: null, category: { enabled: true } },
      select: { name: true, price: true },
    });
    if (!product || new Prisma.Decimal(args.price).gt(product.price))
      throw new BadRequestException('商品不可用或秒杀价高于商品现价');
    return {
      ok: true,
      action: await this.draftAction(user, ctx, 'CREATE_SECKILL', {
        input: args,
        summary: { productName: product.name, regularPrice: product.price.toFixed(2) },
        ...(proposal
          ? {
              proposal: {
                ...proposal,
                notice:
                  '商品与现价来自业务库；价格、名额、名称和时间为待确认建议，不代表已有库存或收益承诺。',
              },
            }
          : {}),
      }),
      definition:
        '尚未发布，需点击确认；确认后原服务复核商品和活动价格，发布启用活动，每会员限一件。',
    };
  }
  async proposeSeckill(user: AuthUser, ctx: ExecutionContext, input: unknown) {
    if (!ctx.allowSuggestedSeckill)
      throw new BadRequestException('仅在用户明确委托分析并制定秒杀方案时，才能代拟参数');
    const { rationale, ...args } = seckillProposalSchema.parse(input);
    return this.prepareSeckill(user, ctx, args, {
      rationale,
      basis: '已查询当前商品目录和销售统计；经营归因与方案效果属于待验证建议。',
    });
  }
  async reviseSeckill(user: AuthUser, id: string, input: unknown, credential: string) {
    const args = reviseSeckillSchema.parse(input),
      old = await this.detail(user, id);
    if (old.kind !== 'CREATE_SECKILL' || !(old.payload as { proposal?: unknown }).proposal)
      throw new BadRequestException('此操作不是可编辑秒杀建议草稿');
    const c = await this.db.agentConversation.findFirstOrThrow({
      where: { id: old.conversationId, userId: user.id },
    });
    const leaseToken = randomUUID();
    const claim = await this.db.agentConversation.updateMany({
      where: {
        id: c.id,
        userId: user.id,
        version: c.version,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseToken, leaseUntil: new Date(Date.now() + 90000) },
    });
    if (!claim.count) throw new ConflictException('会话正在处理，请稍后修改');
    try {
      const p = old.payload as { input: unknown; proposal: { rationale: string; basis: string } };
      return await this.prepareSeckill(
        user,
        {
          conversationId: c.id,
          runId: old.runId,
          credential,
          leaseToken,
          replacesAction: { id, hash: args.expectedHash, version: args.expectedVersion },
        },
        { ...(p.input as object), ...args.changes },
        {
          ...p.proposal,
          rationale: (
            '管理员已调整方案，以当前参数为准。原推荐依据：' + p.proposal.rationale
          ).slice(0, 1200),
          basis: '管理员已调整建议参数，确认前仍由原业务服务复核。',
        },
      );
    } finally {
      await this.db.agentConversation.updateMany({
        where: { id: c.id, userId: user.id, leaseToken },
        data: { leaseToken: null, leaseUntil: null, version: { increment: 1 } },
      });
    }
  }
  async getOrder(user: AuthUser, input: unknown) {
    this.permission(user, 'order:view');
    const { orderId } = orderIdSchema.parse(input);
    const o = await this.orders.detail(user, orderId);
    return {
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      ...fulfillmentView(o),
      source: o.source,
      memberId: o.memberId,
      storeId: o.storeId,
      payableAmount: o.payableAmount.toFixed(2),
      paidAmount: o.paidAmount.toFixed(2),
      orderedAt: o.orderedAt,
      items: o.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        productCode: item.productCode,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        subtotal: item.subtotal.toFixed(2),
      })),
    };
  }
  async paymentStatus(user: AuthUser, input: unknown) {
    this.permission(user, 'order:view');
    return this.payments.detail(user, orderIdSchema.parse(input).orderId);
  }
  private async draftAction(
    user: AuthUser,
    ctx: ExecutionContext,
    kind: string,
    payload: unknown,
    draftId?: string,
  ) {
    let linkedPlan: MemberState['operationPlan'];
    const replacedPayload = ctx.replacesAction
      ? { ...(payload as object), replacesActionId: ctx.replacesAction.id }
      : payload;
    const frozenPayload = ctx.batchParentKey
      ? { ...(replacedPayload as object), batchParentKey: ctx.batchParentKey }
      : replacedPayload;
    const drafted = await this.db.$transaction(async (tx) => {
      // 【串行草稿】锁定Agent会话，防止并行工具留下多个有效旧确认。
      await tx.$queryRaw`SELECT "id" FROM "AgentConversation" WHERE "id" = ${ctx.conversationId} FOR UPDATE`;
      if (
        ['BATCH_CREATE_ORDERS', 'BATCH_OPERATIONS'].includes(kind) &&
        (await tx.agentAction.findFirst({
          where: {
            userId: user.id,
            conversationId: ctx.conversationId,
            kind: { in: ['BATCH_CREATE_ORDERS', 'BATCH_OPERATIONS'] },
            status: { in: ['EXECUTING', 'UNKNOWN'] },
          },
        }))
      )
        throw new ConflictException('当前会话有结果待核对的批次，请先恢复原批次');
      if (
        ctx.leaseToken &&
        !(await tx.agentConversation.findFirst({
          where: {
            id: ctx.conversationId,
            userId: user.id,
            leaseToken: ctx.leaseToken,
            leaseUntil: { gt: new Date() },
          },
        }))
      )
        throw new ConflictException('任务已过期，请重新报价');
      if (ctx.replacesAction) {
        const previous = ctx.replacesAction;
        await tx.$queryRaw`SELECT "id" FROM "AgentAction" WHERE "id" = ${previous.id} FOR UPDATE`;
        const action = await tx.agentAction.findFirst({
          where: {
            id: previous.id,
            userId: user.id,
            conversationId: ctx.conversationId,
            status: 'WAITING_CONFIRMATION',
            payloadHash: previous.hash,
            version: previous.version,
            expiresAt: { gt: new Date() },
          },
        });
        if (!action) throw new ConflictException('原方案已确认、过期或变化，请重新生成草稿');
      }
      const conversation = await tx.agentConversation.findUniqueOrThrow({
        where: { id: ctx.conversationId },
      });
      const conversationState = conversation.state as MemberState;
      let planStep: NonNullable<MemberState['operationPlan']>['steps'][number] | undefined;
      if (
        !ctx.batchParentKey &&
        conversationState.operationPlan &&
        !conversationState.operationPlan.canceled
      ) {
        for (const step of conversationState.operationPlan.steps) {
          let previous;
          if (step.actionId) {
            await tx.$queryRaw`SELECT "id" FROM "AgentAction" WHERE "id" = ${step.actionId} FOR UPDATE`;
            previous = await tx.agentAction.findUniqueOrThrow({ where: { id: step.actionId } });
          }
          if (previous?.status === 'SUCCEEDED') continue;
          if (previous && ['EXECUTING', 'UNKNOWN'].includes(previous.status))
            throw new ConflictException('当前步骤执行结果待核对，不能重建');
          if (step.kind !== kind)
            throw new ConflictException(
              '当前任务下一步为「' + step.title + '」，请先完成或停止剩余步骤',
            );
          planStep = step;
          break;
        }
      }
      if (ctx.taskLink) {
        const conversation = await tx.agentConversation.findUniqueOrThrow({
          where: { id: ctx.conversationId },
        });
        const plan = (conversation.state as MemberState).taskPlan;
        if (plan?.id !== ctx.taskLink.planId) throw new ConflictException('任务已变化');
        const previousId = plan[ctx.taskLink.field];
        if (previousId) {
          await tx.$queryRaw`SELECT "id" FROM "AgentAction" WHERE "id" = ${previousId} FOR UPDATE`;
          const previous = await tx.agentAction.findUniqueOrThrow({ where: { id: previousId } });
          if (['SUCCEEDED', 'EXECUTING', 'UNKNOWN'].includes(previous.status))
            throw new ConflictException('上一步结果已变化，请续接任务核对，不会重复创建');
        }
      }
      if (!ctx.batchParentKey)
        await tx.agentAction.updateMany({
          where: {
            userId: user.id,
            conversationId: ctx.conversationId,
            status: 'WAITING_CONFIRMATION',
            id: { in: await topLevelActionIds(tx, user.id, ctx.conversationId) },
          },
          data: { status: 'EXPIRED', version: { increment: 1 } },
        });
      const action = await tx.agentAction.create({
        data: {
          userId: user.id,
          conversationId: ctx.conversationId,
          runId: ctx.runId,
          kind,
          payload: json(frozenPayload),
          payloadHash: digest(frozenPayload),
          draftId,
          requestId: randomUUID(),
          expiresAt: new Date(Date.now() + 120000),
        },
      });
      if (planStep && conversationState.operationPlan) {
        planStep.actionId = action.id;
        await tx.agentConversation.update({
          where: { id: ctx.conversationId },
          data: { state: json(conversationState) },
        });
        linkedPlan = conversationState.operationPlan;
      }
      if (ctx.taskLink) {
        const c = await tx.agentConversation.findUniqueOrThrow({
          where: { id: ctx.conversationId },
        });
        const state = c.state as MemberState;
        if (state.taskPlan?.id !== ctx.taskLink.planId)
          throw new ConflictException('任务已变化，不能链接操作');
        state.taskPlan[ctx.taskLink.field] = action.id;
        await tx.agentConversation.update({ where: { id: c.id }, data: { state: json(state) } });
      }
      if (ctx.replacesAction) {
        const c = await tx.agentConversation.findUniqueOrThrow({
          where: { id: ctx.conversationId },
        });
        await tx.agentConversation.update({
          where: { id: c.id },
          data: { state: json({ ...(c.state as object), lastActionId: action.id }) },
        });
      }
      return action;
    });
    if (linkedPlan && ctx.entities) ctx.entities.operationPlan = linkedPlan;
    return drafted;
  }
  async prepareBatchOperations(
    user: AuthUser,
    ctx: ExecutionContext,
    input: unknown,
    state: MemberState,
    simulated = false,
  ) {
    return new BatchOperations(this.db).preview(
      user,
      ctx,
      input,
      state,
      (child, operation, args, entities) =>
        this.prepareBatchItem(user, child, operation, args, entities),
      (context, payload) => this.draftAction(user, context, 'BATCH_OPERATIONS', payload),
      simulated,
    );
  }
  async prepareGeneratedMembers(
    user: AuthUser,
    ctx: ExecutionContext,
    input: unknown,
    state: MemberState,
  ) {
    this.permission(user, 'member:create', 'member:view');
    const args = await new BatchOperations(this.db).generatedInput(input);
    return this.prepareBatchOperations(user, ctx, args, state, true);
  }
  private async prepareBatchItem(
    user: AuthUser,
    ctx: ExecutionContext,
    operation: string,
    input: unknown,
    state: MemberState,
  ) {
    if (operation === 'MEMBER_CREATE') return this.prepareMember(user, ctx, input, state, true);
    if (operation === 'MEMBER_EDIT') return this.prepareMemberEdit(user, ctx, input, state);
    if (operation === 'PRODUCT_EDIT') return this.prepareProductEdit(user, ctx, input);
    if (operation === 'PRODUCT_STOCK') return this.prepareProductStock(user, ctx, input);
    if (operation === 'PRODUCT_CREATE' || operation === 'PRODUCT_RENAME')
      return this.prepareProduct(user, ctx, input, operation === 'PRODUCT_CREATE');
    if (['COUPON_TEMPLATE_CREATE', 'COUPON_ISSUE', 'SECKILL_TOGGLE'].includes(operation))
      return this.prepareCommerce(
        user,
        ctx,
        operation as 'COUPON_TEMPLATE_CREATE' | 'COUPON_ISSUE' | 'SECKILL_TOGGLE',
        input,
      );
    if (['COUPON_TEMPLATE_UPDATE', 'COUPON_TEMPLATE_DISABLE', 'COUPON_VOID'].includes(operation))
      return this.prepareCouponChange(
        user,
        ctx,
        operation as 'COUPON_TEMPLATE_UPDATE' | 'COUPON_TEMPLATE_DISABLE' | 'COUPON_VOID',
        input,
      );
    if (operation === 'ORDER_CREATE') return this.quote(user, ctx, input, state);
    if (operation === 'SECKILL_CREATE') return this.prepareSeckill(user, ctx, input);
    if (operation === 'ORDER_CANCEL' || operation === 'PAYMENT' || operation === 'REFUND')
      return this.prepare(
        user,
        ctx,
        operation === 'ORDER_CANCEL' ? 'CANCEL_ORDER' : operation,
        input,
      );
    if (operation === 'ORDER_SHIP' || operation === 'ORDER_RECEIVE')
      return this.prepareFulfillment(
        user,
        ctx,
        input,
        operation === 'ORDER_SHIP' ? 'ship' : 'receive',
      );
    if (new BusinessOperations(this.config).definition(operation))
      return this.prepareBusiness(user, ctx, operation, input, state);
    if (CATALOG_OPERATIONS.some((d) => d.kind === operation))
      return this.prepareCatalog(user, ctx, operation, input);
    throw new BadRequestException('不支持该批量业务');
  }
  async prepareProductStock(user: AuthUser, ctx: ExecutionContext, input: unknown) {
    this.permission(user, 'product:view', 'product:edit');
    if (!user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('库存管理需要ALL范围');
    const args = productStockSchema.parse(input);
    const current = await this.db.product.findUnique({ where: { id: args.productId } });
    if (!current || current.deletedAt) throw new NotFoundException('商品不存在');
    if (args.mode === 'ADD' && current.stockOnHand === null)
      throw new BadRequestException('库存尚未初始化，请明确设置现存量');
    const quantity = args.mode === 'ADD' ? current.stockOnHand! + args.quantity : args.quantity;
    if (quantity < current.stockReserved || quantity < 0 || quantity > 1000000000)
      throw new BadRequestException('目标库存无效或低于订单占用量');
    const warning = args.warning ?? current.stockWarning;
    return {
      ok: true,
      action: await this.draftAction(user, ctx, 'PRODUCT_STOCK', {
        input: {
          productId: current.id,
          quantity,
          warning,
          version: current.stockVersion,
          reason: args.reason,
        },
        summary: { name: current.name },
        fields: [
          { label: '现存库存', before: current.stockOnHand, after: quantity },
          { label: '库存预警', before: current.stockWarning, after: warning },
        ],
        reason: args.reason,
      }),
      definition:
        '库存目标及版本已冻结，确认后调用原库存调整规则并记录流水；增加库存只执行一次，已有订单占用不可覆盖。',
    };
  }
  async prepareFulfillment(
    user: AuthUser,
    ctx: ExecutionContext,
    input: unknown,
    step: 'ship' | 'receive',
  ) {
    this.permission(user, 'order:view', 'order:fulfill');
    const args = orderIdSchema.parse(input);
    const order = await this.getOrder(user, args);
    if (
      order.source !== 'BACKOFFICE' ||
      order.status !== 'PAID' ||
      (step === 'receive' && !order.shippedAt)
    )
      throw new BadRequestException('当前订单不符合模拟履约条件，请先核对支付与发货状态');
    const action = await this.draftAction(
      user,
      ctx,
      step === 'ship' ? 'ORDER_SHIP' : 'ORDER_RECEIVE',
      { ...args, order },
    );
    return {
      ok: true,
      action,
      definition: '仅预览，确认后调用原模拟履约服务；不触发真实物流、不伪造支付成功。',
    };
  }
  async prepareBatchOrders(
    user: AuthUser,
    ctx: ExecutionContext,
    input: unknown,
    state: MemberState,
  ) {
    new BatchOrders(this.db, this.orders).policy(user);
    if (
      await this.db.agentAction.findFirst({
        where: {
          userId: user.id,
          conversationId: ctx.conversationId,
          kind: 'BATCH_CREATE_ORDERS',
          status: { in: ['EXECUTING', 'UNKNOWN'] },
        },
      })
    )
      throw new ConflictException('当前会话有结果待核对的批次，请先恢复原批次，不会重新随机选人');
    const payload = await new BatchOrders(this.db, this.orders).preview(
      user,
      input,
      state.lastActivityId,
    );
    const action = await this.draftAction(user, ctx, 'BATCH_CREATE_ORDERS', payload);
    return {
      ok: true,
      action,
      definition:
        '已随机选择已有会员并固定名单，仅报价；点击卡片一次确认后逐笔创建待支付订单，不会自动支付。部分失败不会替换会员或重复创建已成功订单。',
    };
  }
  async quote(user: AuthUser, ctx: ExecutionContext, input: unknown, state: MemberState) {
    this.permission(user, 'order:create', 'member:view');
    if (!user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('个人会员下单仅开放ALL账号');
    const args = quoteSchema.parse(input);
    if (args.memberId !== state.selectedMemberId)
      throw new BadRequestException('请先精确查询或选择要下单的会员');
    if (new Set(args.items.map((i) => i.productId)).size !== args.items.length)
      throw new BadRequestException('同一商品请合并数量后重新报价');
    const dto = plainToInstance(QuoteOrderDto, args);
    await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
    const quote = await this.orders.quote(user, dto);
    const draft = await this.db.agentDraft.create({
      data: {
        userId: user.id,
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        input: json(args),
        quote: json(quote),
        quoteHash: quote.quoteHash,
        expiresAt: new Date(Date.now() + 120000),
      },
    });
    const member = await this.members.detail(args.memberId);
    const action = await this.draftAction(
      user,
      ctx,
      'CREATE_ORDER',
      {
        input: args,
        quoteHash: quote.quoteHash,
        quote,
        member: { name: member.name, maskedPhone: maskPhone(member.phone) },
      },
      draft.id,
    );
    return {
      ok: true,
      action,
      definition:
        '仅报价预览，尚未创建订单。必须点击确认卡授权；继续提问或修改内容将使旧确认失效。',
    };
  }
  async prepare(
    user: AuthUser,
    ctx: ExecutionContext,
    kind: 'CANCEL_ORDER' | 'PAYMENT' | 'REFUND',
    input: unknown,
  ) {
    const args = kind === 'REFUND' ? refundSchema.parse(input) : orderIdSchema.parse(input);
    this.permission(
      user,
      'order:view',
      kind === 'CANCEL_ORDER' ? 'order:cancel' : kind === 'PAYMENT' ? 'order:pay' : 'order:refund',
    );
    const order = await this.getOrder(user, { orderId: args.orderId });
    if (order.source !== 'BACKOFFICE') throw new BadRequestException('历史导入订单不可执行此操作');
    if (kind === 'CANCEL_ORDER' && order.status !== 'PENDING_PAYMENT')
      throw new BadRequestException('仅能取消待支付后台订单，不会自动退款');
    const payment = kind === 'CANCEL_ORDER' ? null : await this.payments.detail(user, order.id);
    if (kind === 'PAYMENT' && order.status !== 'PENDING_PAYMENT')
      throw new BadRequestException('订单当前不能发起支付');
    if (
      kind === 'REFUND' &&
      (!['PAID', 'COMPLETED'].includes(order.status) || payment?.payment?.status !== 'SUCCEEDED')
    )
      throw new BadRequestException('仅成功支付且未退款订单可申请整单退款');
    const action = await this.draftAction(user, ctx, kind, {
      ...args,
      order,
      previousAttempt:
        kind === 'REFUND' ? payment?.refund?.attempt || 0 : payment?.payment?.attempt || 0,
    });
    return {
      ok: true,
      action,
      definition: '尚未执行。请点击确认；支付与退款仅MOCK，发起申请不等于成功。',
    };
  }
  async detail(user: AuthUser, id: string) {
    const row = await this.db.agentAction.findFirst({ where: { id, userId: user.id } });
    if (!row) throw new NotFoundException('操作不存在');
    if (
      !(await this.db.agentConversation.findFirst({
        where: { id: row.conversationId, userId: user.id },
      }))
    )
      throw new NotFoundException('会话已删除');
    return row;
  }
  // 【人工确认】确认只接受版本和内容hash，绝不接受替换金额/输入；模型没有执行工具。
  async confirm(
    user: AuthUser,
    id: string,
    input: unknown,
    credential = '',
    parent?: import('@prisma/client').AgentAction,
  ) {
    if (this.config.get('AGENT_WRITES_ENABLED', 'false') !== 'true')
      throw new ForbiddenException('Agent写操作已关闭，仍可查询和报价');
    const parsed = confirmSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('确认参数格式错误');
    const args = parsed.data;
    const action = await this.detail(user, id);
    const isBatch = ['BATCH_CREATE_ORDERS', 'BATCH_OPERATIONS'].includes(action.kind);
    if (action.kind === 'BATCH_OPERATIONS' && !user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('批量编排需要ALL范围');
    const parentKey = (action.payload as { batchParentKey?: string }).batchParentKey;
    if (parentKey) {
      if (!parent) throw new ForbiddenException('批量子操作只能随所属批次确认执行');
      const owner = await this.detail(user, parent.id);
      const ownerPayload = owner.payload as unknown as BatchOperationsPayload;
      if (
        owner.kind !== 'BATCH_OPERATIONS' ||
        owner.status !== 'EXECUTING' ||
        owner.version !== parent.version + 1 ||
        !owner.approvedAt ||
        !owner.leaseUntil ||
        owner.leaseUntil <= new Date() ||
        ownerPayload.batchKey !== parentKey ||
        !ownerPayload.batchOperations.rows.some(
          (r) => r.actionId === id && r.payloadHash === action.payloadHash,
        )
      )
        throw new ForbiddenException('所属批次未获当前有效批准');
    }
    const catalogDefinition = CATALOG_OPERATIONS.find((d) => d.kind === action.kind);
    const businessDefinition = new BusinessOperations(this.config).definition(action.kind);
    this.permission(
      user,
      'dashboard:view',
      action.kind === 'BATCH_OPERATIONS'
        ? 'dashboard:view'
        : ['ORDER_SHIP', 'ORDER_RECEIVE'].includes(action.kind)
          ? 'order:fulfill'
          : action.kind === 'PRODUCT_STOCK'
            ? 'product:edit'
            : businessDefinition
              ? businessDefinition.permissions[1]
              : catalogDefinition
                ? catalogDefinition.permission
                : action.kind === 'PRODUCT_CREATE'
                  ? 'product:create'
                  : ['PRODUCT_RENAME', 'PRODUCT_EDIT'].includes(action.kind)
                    ? 'product:edit'
                    : [
                          'COUPON_TEMPLATE_CREATE',
                          'COUPON_ISSUE',
                          'COUPON_TEMPLATE_UPDATE',
                          'COUPON_TEMPLATE_DISABLE',
                          'COUPON_VOID',
                        ].includes(action.kind)
                      ? 'member:coupon-issue'
                      : action.kind === 'SECKILL_TOGGLE'
                        ? 'seckill:manage'
                        : action.kind === 'CREATE_MEMBER'
                          ? 'member:create'
                          : ['RENAME_MEMBER', 'EDIT_MEMBER'].includes(action.kind)
                            ? 'member:edit'
                            : action.kind === 'CREATE_SECKILL'
                              ? 'seckill:manage'
                              : ['CREATE_ORDER', 'BATCH_CREATE_ORDERS'].includes(action.kind)
                                ? 'order:create'
                                : action.kind === 'CANCEL_ORDER'
                                  ? 'order:cancel'
                                  : action.kind === 'PAYMENT'
                                    ? 'order:pay'
                                    : 'order:refund',
    );
    if (
      [
        'COUPON_TEMPLATE_CREATE',
        'COUPON_ISSUE',
        'SECKILL_TOGGLE',
        'COUPON_TEMPLATE_UPDATE',
        'COUPON_TEMPLATE_DISABLE',
        'COUPON_VOID',
      ].includes(action.kind)
    ) {
      if (action.kind !== 'SECKILL_TOGGLE') this.permission(user, 'member:view');
      if (!user.roles.some((r) => r.dataScope === 'ALL'))
        throw new ForbiddenException('营销权限范围已变化');
    }
    if (['CREATE_ORDER', 'CREATE_MEMBER', 'RENAME_MEMBER', 'EDIT_MEMBER'].includes(action.kind)) {
      this.permission(user, 'member:view');
      if (!user.roles.some((r) => r.dataScope === 'ALL'))
        throw new ForbiddenException('会员权限已变化');
    }
    if (action.kind === 'BATCH_CREATE_ORDERS') new BatchOrders(this.db, this.orders).policy(user);
    if (action.kind === 'PRODUCT_STOCK') {
      this.permission(user, 'product:view');
      if (!user.roles.some((r) => r.dataScope === 'ALL'))
        throw new ForbiddenException('库存管理需要ALL范围');
    }
    if (args.expectedHash !== action.payloadHash) throw new ConflictException('确认内容已变化');
    if (action.status === 'SUCCEEDED' || action.status === 'REJECTED') return action;
    if (action.status === 'FAILED')
      throw new ConflictException(
        '本次操作已被业务拒绝，请调整条件并生成新的预览，不会重复提交旧卡',
      );
    if (action.status === 'EXECUTING' && action.leaseUntil && action.leaseUntil > new Date())
      return action;
    const recovery = ['UNKNOWN', 'EXECUTING'].includes(action.status);
    if (businessDefinition) {
      if (
        !businessDefinition.permissions.every((p) => user.permissions.includes(p)) ||
        !user.roles.some((r) => r.dataScope === 'ALL')
      )
        throw new ForbiddenException('业务权限或数据范围已变化');
      if (recovery && !action.result)
        throw new ConflictException('结果待核对，请查询原业务配置或导入任务，不会自动重发');
    }
    if (action.kind === 'COUPON_TEMPLATE_UPDATE' && recovery && !action.result)
      throw new ConflictException('模板版本更新结果待核对，不会自动重复发布，请查询模板目录');
    if (catalogDefinition) {
      new CatalogOperations(this.config).policy(user, action.kind);
      if (recovery && !action.result)
        throw new ConflictException('资料操作结果待核对，不会自动重发；请到对应管理页面核对');
    }
    if (['PRODUCT_CREATE', 'PRODUCT_RENAME', 'PRODUCT_EDIT'].includes(action.kind)) {
      this.permission(user, 'product:view');
      if (!user.roles.some((r) => r.dataScope === 'ALL'))
        throw new ForbiddenException('商品数据范围已变化');
      if (recovery && !action.result && !parentKey)
        throw new ConflictException('商品操作结果待核对，请到商品管理核对；不会自动重发写请求');
    }
    if (
      !recovery &&
      (action.status !== 'WAITING_CONFIRMATION' ||
        action.version !== args.expectedVersion ||
        (!parentKey && action.expiresAt < new Date()))
    )
      throw new ConflictException('确认已过期或版本已变化，请重新预览');
    if (args.decision === 'REJECT') {
      if (recovery) throw new ConflictException('执行结果尚未核实，不能将停止等同撤销');
      const rejected = await this.db.agentAction.updateMany({
        where: { id, userId: user.id, status: 'WAITING_CONFIRMATION', version: action.version },
        data: { status: 'REJECTED', version: { increment: 1 } },
      });
      if (!rejected.count) throw new ConflictException('操作已被其他请求处理');
      return this.detail(user, id);
    }
    const claimInput = {
      where: { id, userId: user.id, status: action.status, version: action.version },
      data: {
        status: 'EXECUTING',
        approvedAt: action.approvedAt || new Date(),
        leaseUntil: new Date(Date.now() + 120000),
        version: { increment: 1 },
      },
    };
    const claim = isBatch
      ? await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "AgentConversation" WHERE "id" = ${action.conversationId} FOR UPDATE`;
          return tx.agentAction.updateMany(claimInput);
        })
      : await this.db.agentAction.updateMany(claimInput);
    if (!claim.count) return this.detail(user, id);
    const payload = action.payload as Record<string, unknown>;
    let result: unknown;
    let productCommitted = false;
    try {
      if (parentKey && payload.noChange === true) {
        const draftInput =
          action.kind === 'EDIT_MEMBER'
            ? ((await this.db.agentDraft.findUniqueOrThrow({ where: { id: action.draftId! } }))
                .input as { memberId: string })
            : null;
        const target =
          action.kind === 'PRODUCT_EDIT'
            ? await this.db.product.findUnique({
                where: { id: (payload.input as { productId: string }).productId },
              })
            : await this.db.member.findUnique({ where: { id: draftInput!.memberId } });
        if (
          !target ||
          target.updatedAt.toISOString() !== (payload.before as { updatedAt: string }).updatedAt
        )
          throw new ConflictException('对象资料已变化，请重新预览');
        result = { id: target.id, name: target.name, status: 'UNCHANGED' };
      } else if (action.kind === 'BATCH_OPERATIONS') {
        result = await new BatchOperations(this.db).execute(
          user,
          action,
          (current, childId, decision, batch) =>
            this.confirm(current, childId, decision, credential, batch),
        );
      } else if (action.kind === 'PRODUCT_STOCK') {
        result = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "AgentAction" WHERE "id" = ${id} FOR UPDATE`;
          const saved = await tx.agentAction.findUniqueOrThrow({ where: { id } });
          if (saved.result) return saved.result;
          const args = payload.input as {
            productId: string;
            quantity: number;
            version: number;
            warning: number;
            reason: string;
          };
          await adjustStock(
            tx,
            args.productId,
            args.quantity,
            args.version,
            user.id,
            args.reason,
            action.requestId,
            args.warning,
          );
          const value = { id: args.productId, status: 'STOCK_ADJUSTED', quantity: args.quantity };
          await tx.agentAction.update({ where: { id }, data: { result: json(value) } });
          return value;
        });
      } else if (
        ['COUPON_TEMPLATE_UPDATE', 'COUPON_TEMPLATE_DISABLE', 'COUPON_VOID'].includes(action.kind)
      ) {
        if (action.result) result = action.result;
        else {
          const service = new CouponsService(this.db);
          if (action.kind === 'COUPON_TEMPLATE_UPDATE') {
            const { templateId, ...fields } = payload.input as {
              templateId: string;
              name: string;
              minimumSpend: string;
              discountAmount: string;
              startsAt: string;
              endsAt: string;
              version: number;
            };
            const dto = plainToInstance(UpdateCouponTemplateDto, fields);
            await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
            const changed = await service.updateTemplate(templateId, dto);
            result = {
              id: changed.id,
              name: changed.name,
              version: changed.version,
              status: 'TEMPLATE_UPDATED',
            };
          } else if (action.kind === 'COUPON_TEMPLATE_DISABLE') {
            const args = payload.input as { templateId: string };
            result = { ...(await service.deleteTemplate(args.templateId)), status: 'DISABLED' };
          } else {
            const args = couponVoidSchema.parse(payload.input);
            result = {
              ...(await service.voidCoupon(args.memberId, args.couponId)),
              status: 'VOID',
            };
          }
          await this.db.agentAction.update({ where: { id }, data: { result: json(result) } });
        }
      } else if (businessDefinition) {
        result =
          action.result ||
          (await new BusinessOperations(this.config).execute(
            user,
            credential,
            action.kind,
            payload,
          ));
        await this.db.agentAction.update({ where: { id }, data: { result: json(result) } });
      } else if (catalogDefinition) {
        result =
          action.result ||
          (await new CatalogOperations(this.config).execute(
            user,
            credential,
            action.kind,
            payload,
          ));
        await this.db.agentAction.update({ where: { id }, data: { result: json(result) } });
      } else if (
        parentKey &&
        ['PRODUCT_CREATE', 'PRODUCT_RENAME', 'PRODUCT_EDIT'].includes(action.kind)
      ) {
        result = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "AgentAction" WHERE "id"=${id} FOR UPDATE`;
          const saved = await tx.agentAction.findUniqueOrThrow({ where: { id } });
          if (saved.result) return saved.result;
          const service = new ProductsService(transactionService(tx), new DataScopeService());
          let product;
          if (action.kind === 'PRODUCT_CREATE') {
            const args = productCreateSchema.parse(payload.input);
            const dto = plainToInstance(ProductDto, {
              ...args,
              price: Number(args.price),
              costPrice: Number(args.costPrice),
            });
            await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
            product = await service.create(dto);
          } else {
            const args =
              action.kind === 'PRODUCT_EDIT'
                ? productEditSchema.parse(payload.input)
                : productRenameSchema.parse(payload.input);
            await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${args.productId} FOR UPDATE`;
            const current = await service.detail(args.productId);
            if (
              !current ||
              current.deletedAt ||
              current.updatedAt.toISOString() !==
                (payload.before as { updatedAt: string }).updatedAt
            )
              throw new ConflictException('商品资料已变化，请重新预览');
            const changes = 'changes' in args ? args.changes : { name: args.name };
            const dto = plainToInstance(UpdateProductDto, {
              ...changes,
              ...('price' in changes && changes.price !== undefined
                ? { price: Number(changes.price) }
                : {}),
              ...('costPrice' in changes && changes.costPrice !== undefined
                ? { costPrice: Number(changes.costPrice) }
                : {}),
            });
            await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
            product = await service.update(args.productId, dto);
          }
          const value = {
            id: product.id,
            name: product.name,
            code: product.code,
            status: product.enabled ? 'ENABLED' : 'DISABLED',
          };
          await tx.agentAction.update({ where: { id }, data: { result: json(value) } });
          return value;
        });
      } else if (['PRODUCT_CREATE', 'PRODUCT_RENAME', 'PRODUCT_EDIT'].includes(action.kind)) {
        if (action.result) result = action.result;
        else {
          let product: Record<string, unknown>;
          if (action.kind === 'PRODUCT_CREATE') {
            const args = productCreateSchema.parse(payload.input);
            product = await this.productApi(credential, 'products', 'POST', {
              ...args,
              price: Number(args.price),
              costPrice: Number(args.costPrice),
              enabled: args.enabled ?? true,
            });
          } else {
            const args =
              action.kind === 'PRODUCT_EDIT'
                ? productEditSchema.parse(payload.input)
                : productRenameSchema.parse(payload.input);
            const current = await this.productApi(
              credential,
              'products/' + encodeURIComponent(args.productId),
            );
            if (current.updatedAt !== (payload.before as { updatedAt: string }).updatedAt)
              throw new ConflictException('商品资料已变化，请重新预览');
            product = await this.productApi(
              credential,
              'products/' + encodeURIComponent(args.productId),
              'PATCH',
              'changes' in args
                ? {
                    ...args.changes,
                    ...(args.changes.price !== undefined
                      ? { price: Number(args.changes.price) }
                      : {}),
                    ...(args.changes.costPrice !== undefined
                      ? { costPrice: Number(args.changes.costPrice) }
                      : {}),
                  }
                : { name: args.name },
            );
          }
          productCommitted = true;
          const actual = await this.productApi(
            credential,
            'products/' + encodeURIComponent(String(product.id)),
          );
          result = {
            id: actual.id,
            name: actual.name,
            code: actual.code,
            status: actual.enabled ? 'ENABLED' : 'DISABLED',
          };
          await this.db.agentAction.update({ where: { id }, data: { result: json(result) } });
        }
      } else if (action.kind === 'COUPON_TEMPLATE_CREATE' || action.kind === 'SECKILL_TOGGLE') {
        result = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "AgentAction" WHERE "id" = ${id} FOR UPDATE`;
          const saved = await tx.agentAction.findUniqueOrThrow({ where: { id } });
          if (saved.result) return saved.result;
          let value: unknown;
          if (action.kind === 'COUPON_TEMPLATE_CREATE') {
            const dto = plainToInstance(
              CreateCouponTemplateDto,
              couponTemplateSchema.parse(payload.input),
            );
            await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
            const template = await new CouponsService(transactionService(tx)).createTemplate(dto);
            value = {
              id: template.id,
              name: template.name,
              status: 'TEMPLATE_CREATED',
              version: template.version,
            };
          } else {
            const args = seckillToggleSchema.parse(payload.input);
            const current = (
              await new SeckillService(transactionService(tx), this.orders).list()
            ).find((a) => a.id === args.activityId);
            if (!current || current.enabled !== (payload.before as { enabled: boolean }).enabled)
              throw new ConflictException('活动状态已变化，请重新预览');
            await new SeckillService(transactionService(tx), this.orders).toggle(
              args.activityId,
              args.enabled,
            );
            value = { id: args.activityId, status: args.enabled ? 'ENABLED' : 'DISABLED' };
          }
          await tx.agentAction.update({ where: { id }, data: { result: json(value) } });
          return value;
        });
      } else if (action.kind === 'COUPON_ISSUE') {
        const args = couponIssueSchema.parse(payload.input);
        const service = new CouponsService(this.db);
        const dto = plainToInstance(BatchIssueCouponDto, {
          ...args,
          mode: 'SELECTED',
          requestId: action.requestId,
        });
        await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
        result = { ...(await service.issueBatch(user, dto)), status: 'ISSUED' };
      } else if (['CREATE_MEMBER', 'RENAME_MEMBER', 'EDIT_MEMBER'].includes(action.kind)) {
        // 【原子恢复】复用原会员Service并绑定事务，会员写入与动作结果一同持久化。
        result = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "AgentAction" WHERE "id" = ${id} FOR UPDATE`;
          const saved = await tx.agentAction.findUniqueOrThrow({ where: { id } });
          if (saved.result) return saved.result;
          const draft = await tx.agentDraft.findFirst({
            where: {
              id: action.draftId!,
              userId: user.id,
              conversationId: action.conversationId,
              runId: action.runId,
            },
          });
          if (!draft) throw new NotFoundException('执行草稿不存在，请重新预览');
          const service = new MembersService(transactionService(tx), this.benefits);
          let member;
          if (action.kind === 'CREATE_MEMBER') {
            const dto = plainToInstance(CreateMemberDto, memberCreateSchema.parse(draft.input));
            await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
            member = await service.create(dto);
          } else {
            const args =
              action.kind === 'EDIT_MEMBER'
                ? memberEditSchema.parse(draft.input)
                : memberRenameSchema.parse(draft.input);
            if (action.kind === 'EDIT_MEMBER')
              await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${args.memberId} FOR UPDATE`;
            const current = await service.detail(args.memberId);
            const before = payload.before as { name: string; updatedAt: string };
            if (
              (action.kind !== 'EDIT_MEMBER' && current.name !== before.name) ||
              current.updatedAt.toISOString() !== before.updatedAt
            )
              throw new ConflictException('会员资料已变化，请重新预览确认');
            const dto = plainToInstance(
              UpdateMemberDto,
              'changes' in args ? args.changes : { name: args.name },
            );
            await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
            member = await service.update(args.memberId, dto);
          }
          const value = {
            id: member.id,
            name: member.name,
            maskedPhone: maskPhone(member.phone),
            status: member.enabled ? 'ENABLED' : 'DISABLED',
          };
          await tx.agentAction.update({ where: { id }, data: { result: json(value) } });
          return value;
        });
      } else if (action.kind === 'CREATE_SECKILL') {
        this.permission(user, 'product:view');
        // 【原子恢复】复用原服务且绑定事务，活动与动作结果一起提交，结果未知时不重复发布。
        result = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "AgentAction" WHERE "id" = ${id} FOR UPDATE`;
          const saved = await tx.agentAction.findUniqueOrThrow({ where: { id } });
          if (saved.result) return saved.result;
          const dto = plainToInstance(CreateSeckillDto, payload.input);
          await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
          const created = await new SeckillService(transactionService(tx), this.orders).create(dto);
          const value = { id: created.id, name: created.name, status: 'ENABLED' };
          await tx.agentAction.update({ where: { id }, data: { result: json(value) } });
          return value;
        });
      } else if (action.kind === 'BATCH_CREATE_ORDERS') {
        result = await new BatchOrders(this.db, this.orders).execute(user, action);
      } else if (action.kind === 'ORDER_SHIP' || action.kind === 'ORDER_RECEIVE') {
        const changed = await this.orders.fulfill(
          user,
          String(payload.orderId),
          action.kind === 'ORDER_SHIP' ? 'ship' : 'receive',
        );
        result = { id: changed.id, orderNo: changed.orderNo, status: changed.status };
      } else if (action.kind === 'CREATE_ORDER') {
        const dto = plainToInstance(CreateOrderDto, {
          ...(payload.input as object),
          quoteHash: payload.quoteHash,
          requestId: action.requestId,
        });
        await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
        // 【幂等恢复】未知结果始终重用原requestId与内容，原Service会先查已建订单再重新报价。
        const order = await this.orders.create(user, dto);
        result = {
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          payableAmount: order.payableAmount.toFixed(2),
        };
      } else if (action.kind === 'CANCEL_ORDER') {
        const order = await this.orders.cancel(user, String(payload.orderId));
        result = { id: order.id, orderNo: order.orderNo, status: order.status };
      } else {
        const status = await this.payments.detail(user, String(payload.orderId));
        const record = action.kind === 'PAYMENT' ? status.payment : status.refund;
        // 【尝试号保护】同一批准不能在渠道失败后无条件再发起新attempt；先核对已有结果。
        if (record && record.attempt > Number(payload.previousAttempt)) result = record;
        else if (action.kind === 'PAYMENT')
          result = await this.payments.start(user, String(payload.orderId));
        else {
          const dto = plainToInstance(RequestRefundDto, { reason: payload.reason });
          await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
          result = await this.payments.requestRefund(user, String(payload.orderId), dto);
        }
      }
      // 【审计发件箱】业务已成功但状态事务失败时保留UNKNOWN，可按原幂等键恢复，绝不另建订单。
      await this.db.$transaction(async (tx) => {
        await tx.agentAction.update({
          where: {
            id,
            ...(isBatch ? { status: 'EXECUTING', version: action.version + 1 } : {}),
          },
          data: {
            status: 'SUCCEEDED',
            result: json(result),
            ...(isBatch ? { errorCode: null } : {}),
            version: { increment: 1 },
            leaseUntil: null,
          },
        });
        const conversation = await tx.agentConversation.findFirst({
          where: { id: action.conversationId, userId: user.id },
        });
        if (conversation && catalogDefinition)
          await tx.agentConversation.update({
            where: { id: conversation.id },
            data: {
              state: {
                ...(conversation.state as object),
                lastActionId: id,
                lastCatalogResource: {
                  id: String((result as { id: string }).id),
                  name: String((result as { name: string }).name),
                  kind: action.kind,
                },
              },
              version: { increment: 1 },
            },
          });
        const entityKey = ['COUPON_TEMPLATE_CREATE', 'COUPON_TEMPLATE_UPDATE'].includes(action.kind)
          ? 'lastCouponTemplateId'
          : ['PRODUCT_CREATE', 'PRODUCT_RENAME', 'PRODUCT_EDIT'].includes(action.kind)
            ? 'lastProductId'
            : ['CREATE_SECKILL', 'SECKILL_TOGGLE'].includes(action.kind)
              ? 'lastActivityId'
              : undefined;
        if (conversation && entityKey)
          await tx.agentConversation.update({
            where: { id: conversation.id },
            data: {
              state: {
                ...(conversation.state as object),
                [entityKey]: (result as { id: string }).id,
                lastActionId: id,
              },
              version: { increment: 1 },
            },
          });
        if (
          conversation &&
          !catalogDefinition &&
          !businessDefinition &&
          ![
            'BATCH_CREATE_ORDERS',
            'BATCH_OPERATIONS',
            'PRODUCT_STOCK',
            'PRODUCT_CREATE',
            'PRODUCT_RENAME',
            'PRODUCT_EDIT',
            'CREATE_SECKILL',
            'SECKILL_TOGGLE',
            'COUPON_ISSUE',
            'COUPON_TEMPLATE_CREATE',
            'COUPON_TEMPLATE_UPDATE',
            'COUPON_TEMPLATE_DISABLE',
            'COUPON_VOID',
          ].includes(action.kind)
        )
          await tx.agentConversation.update({
            where: { id: conversation.id },
            data: {
              state: ['CREATE_MEMBER', 'RENAME_MEMBER', 'EDIT_MEMBER'].includes(action.kind)
                ? {
                    ...(conversation.state as object),
                    selectedMemberId: (result as { id: string }).id,
                    candidateIds: [],
                  }
                : {
                    ...(conversation.state as object),
                    lastOrderId:
                      action.kind === 'CREATE_ORDER'
                        ? (result as { id: string }).id
                        : String(payload.orderId),
                  },
              version: { increment: 1 },
            },
          });
        const priorRun = await tx.agentRun.findUniqueOrThrow({ where: { id: action.runId } });
        await tx.agentRun.update({
          where: { id: action.runId },
          data: {
            status: 'SUCCEEDED',
            state: json({ ...(priorRun.state as object), actionId: id, result }),
            version: { increment: 1 },
          },
        });
        await tx.agentAuditOutbox.upsert({
          where: { actionId_eventType: { actionId: id, eventType: 'SUCCEEDED' } },
          create: { actionId: id, eventType: 'SUCCEEDED', actorId: user.id },
          update: {},
        });
      });
      await this.flushAudit();
      return this.detail(user, id);
    } catch (error) {
      const known =
        !productCommitted &&
        error instanceof HttpException &&
        error.getStatus() >= 400 &&
        error.getStatus() < 500;
      await this.db.agentAction.updateMany({
        where: {
          id,
          userId: user.id,
          status: 'EXECUTING',
          ...(isBatch ? { version: action.version + 1 } : {}),
        },
        data: {
          status: known && !isBatch ? 'FAILED' : 'UNKNOWN',
          errorCode: known && !isBatch ? toolError(error).code : 'RESULT_UNKNOWN',
          ...(known && !isBatch ? { result: json({ failure: toolError(error) }) } : {}),
          leaseUntil: null,
          version: { increment: 1 },
        },
      });
      if (known && !isBatch) throw error;
      return this.detail(user, id);
    }
  }
  async flushAudit() {
    const rows = await this.db.agentAuditOutbox.findMany({ where: { delivered: false }, take: 50 });
    for (const row of rows)
      try {
        await this.db.operationLog.upsert({
          where: { id: 'agent-outbox-' + row.id },
          update: {},
          create: {
            id: 'agent-outbox-' + row.id,
            userId: row.actorId,
            module: 'agent-action',
            action: row.eventType + ' action=' + row.actionId,
            method: 'CONFIRM',
            path: '/agent/actions/' + row.actionId,
            success: true,
          },
        });
        await this.db.agentAuditOutbox.update({ where: { id: row.id }, data: { delivered: true } });
      } catch {
        /* 下次查询或确认时补记，不将业务成功伪装成失败。 */
      }
  }
}
