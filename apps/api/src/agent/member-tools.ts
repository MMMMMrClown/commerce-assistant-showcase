import { ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { CampaignPlan } from './task-plans';
import type { OperationPlan } from './operation-plans';
import type { AuthUser } from '../common/api';
import { MembersService } from '../members/members.service';
import { OrdersService } from '../orders/orders.service';

export const searchMemberSchema = z
  .object({
    keyword: z.string().trim().min(1).max(100),
    match: z.enum(['PHONE_EXACT', 'NAME']),
    page: z.number().int().min(1).max(100).default(1),
    pageSize: z.number().int().min(1).max(10).default(10),
  })
  .strict();
export const memberIdSchema = z.object({ memberId: z.string().min(1).max(100) }).strict();
export const memberOrdersSchema = memberIdSchema
  .extend({
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    status: z.enum(['PENDING_PAYMENT', 'PAID', 'COMPLETED', 'CANCELED', 'REFUNDED']).optional(),
    page: z.number().int().min(1).max(100).default(1),
    pageSize: z.number().int().min(1).max(20).default(10),
  })
  .strict();
export const maskPhone = (phone: string) =>
  phone.length > 7 ? phone.slice(0, 3) + '****' + phone.slice(-4) : '***';
export type MemberState = {
  memberSelection?: import('./batch-operations').MemberSelection;
  productSelection?: import('./batch-operations').ProductSelection;
  operationPlan?: OperationPlan;
  taskPlan?: CampaignPlan;
  lastCatalogResource?: { id: string; name: string; kind: string };
  lastProductId?: string;
  lastActivityId?: string;
  lastActionId?: string;
  lastCouponTemplateId?: string;
  lastOrderId?: string;
  selectedMemberId?: string;
  candidateIds?: string[];
};

@Injectable()
export class MemberTools {
  constructor(
    private readonly members: MembersService,
    private readonly orders: OrdersService,
  ) {}
  // 【权限复核】会员无门店字段，个人档案只开放给有member:view的ALL账号。
  policy(user: AuthUser) {
    if (!user.permissions.includes('member:view') || !user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('当前账号不能查询全平台会员档案');
  }
  async search(user: AuthUser, input: unknown, state: MemberState) {
    this.policy(user);
    const args = searchMemberSchema.parse(input);
    // 【实体失效】开始新搜索即清除旧选择，非法手机号或截断也不能沿用上一位会员。
    delete state.selectedMemberId;
    state.candidateIds = [];
    const keyword =
      args.match === 'PHONE_EXACT' ? args.keyword.replace(/[\s-]/g, '') : args.keyword;
    if (args.match === 'PHONE_EXACT' && !/^\d{11}$/.test(keyword))
      return { ok: false, code: 'INVALID_PHONE', message: '请提供完整11位手机号，不猜测缺失数字' };
    // 【精确匹配】原服务为contains；完整扫描候选后再严格相等，达到边界时不能误报不存在。
    const matches = [] as Awaited<ReturnType<MembersService['list']>>['items'];
    let total = 0;
    const firstPage = args.match === 'PHONE_EXACT' ? 1 : args.page;
    for (let page = firstPage; page <= (args.match === 'PHONE_EXACT' ? 100 : firstPage); page++) {
      const result = await this.members.list({
        keyword,
        page: String(page),
        pageSize: args.match === 'PHONE_EXACT' ? '100' : String(args.pageSize),
      });
      total = result.total;
      matches.push(
        ...result.items.filter((m) => args.match !== 'PHONE_EXACT' || m.phone === keyword),
      );
      if (args.match !== 'PHONE_EXACT' || page * 100 >= total) break;
      if (page === 100)
        return {
          ok: false,
          code: 'SEARCH_TRUNCATED',
          message: '候选过多，尚不能确认精确匹配，请缩小条件',
        };
    }
    let similarName = false;
    let similarTruncated = false;
    // 图片或语音可能将姓名的一字识别错；只提供真实候选，绝不自动纠正或选定。
    if (
      args.match === 'NAME' &&
      args.page === 1 &&
      total === 0 &&
      /^[\p{Script=Han}]{2,4}$/u.test(keyword)
    ) {
      const near = [] as typeof matches;
      for (let page = 1; page <= 3; page++) {
        const result = await this.members.list({
          keyword: keyword[0],
          page: String(page),
          pageSize: '100',
        });
        near.push(
          ...result.items.filter((member) => {
            if (member.name.length !== keyword.length || member.name[0] !== keyword[0])
              return false;
            return (
              [...member.name].filter((character, index) => character !== keyword[index]).length ===
              1
            );
          }),
        );
        similarTruncated = page * 100 < result.total;
        if (!similarTruncated) break;
      }
      if (near.length) {
        similarName = true;
        total = near.length;
        similarTruncated ||= near.length > args.pageSize;
        matches.push(...near.slice(0, args.pageSize));
      }
    }
    const candidates = matches.map((m) => ({
      id: m.id,
      name: m.name,
      maskedPhone: maskPhone(m.phone),
      enabled: m.enabled,
    }));
    const truncated =
      similarTruncated ||
      (args.match === 'NAME' && (args.page - 1) * args.pageSize + matches.length < total);
    state.candidateIds = candidates.map((m) => m.id);
    // 仅精确电话唯一命中可自动选定；姓名即使一条也须用户点选，避免contains误认。
    if (args.match === 'PHONE_EXACT' && candidates.length === 1)
      state.selectedMemberId = candidates[0].id;
    else delete state.selectedMemberId;
    return {
      ok: true,
      code: candidates.length ? 'MEMBER_CANDIDATES' : 'MEMBER_NOT_FOUND',
      candidates,
      total: args.match === 'PHONE_EXACT' ? candidates.length : total,
      page: args.page,
      pageSize: args.pageSize,
      truncated,
      selectionRequired: args.match === 'NAME' && candidates.length > 0,
      ...(similarName
        ? {
            matchQuality: 'SIMILAR_NAME',
            searchedName: keyword,
            message: `未找到姓名“${keyword}”的匹配。以下仅为同姓且一字不同的真实会员，可能是识别错字，也可能是其他人；必须由用户核对姓名和脱敏手机号后点选，确认前不得查询其订单或按其身份操作。`,
          }
        : {}),
    };
  }
  async profile(user: AuthUser, input: unknown, state: MemberState) {
    this.policy(user);
    const { memberId } = memberIdSchema.parse(input);
    if (memberId !== state.selectedMemberId)
      return {
        ok: false,
        code: 'MEMBER_SELECTION_REQUIRED',
        message: '请先搜索会员并由用户选择，完整手机号精确唯一匹配除外',
      };
    const m = await this.members.detail(memberId);
    return {
      ok: true,
      member: {
        id: m.id,
        name: m.name,
        maskedPhone: maskPhone(m.phone),
        enabled: m.enabled,
        tier: m.tier,
        tierName: m.tierName,
        tierSource: m.tierSource,
        discountBps: m.discountBps,
        points: m.points,
        totalSpent: m.totalSpent,
        nextTier: m.nextTier,
      },
      definition: '实时会员权益；停用档案允许查看，不允许建单',
    };
  }
  async listOrders(user: AuthUser, input: unknown, state: MemberState) {
    this.policy(user);
    if (!user.permissions.includes('order:view'))
      throw new ForbiddenException('没有查看订单的权限');
    const args = memberOrdersSchema.parse(input);
    if (args.memberId !== state.selectedMemberId)
      return { ok: false, code: 'MEMBER_SELECTION_REQUIRED', message: '请先确认会员' };
    await this.members.detail(args.memberId);
    const result = await this.orders.list(user, args);
    return {
      ok: true,
      ...result,
      items: result.items.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        orderedAt: o.orderedAt,
        status: o.status,
        store: { id: o.store.id, name: o.store.name },
        payableAmount: o.payableAmount.toFixed(2),
        paidAmount: o.paidAmount.toFixed(2),
        items: o.items.map((i) => ({
          productName: i.productName,
          quantity: i.quantity,
          subtotal: i.subtotal.toFixed(2),
        })),
      })),
      definition:
        '订单按当前账号数据范围返回，不含成本和完整手机号；当前页金额不能代表会员全部消费',
    };
  }
}
