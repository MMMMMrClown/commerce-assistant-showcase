import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/api';
import type { MemberState } from './member-tools';
import { AgentActions, type ExecutionContext } from './actions';
import { CATALOG_OPERATIONS } from './catalog-operations';
import { BUSINESS_OPERATIONS } from './business-operations';
import { availableCapabilities } from './capability-registry';
export const OPERATION_KINDS: Record<string, string> = {
  prepare_member_create: 'CREATE_MEMBER',
  prepare_member_rename: 'RENAME_MEMBER',
  prepare_member_edit: 'EDIT_MEMBER',
  prepare_product_create: 'PRODUCT_CREATE',
  prepare_product_rename: 'PRODUCT_RENAME',
  prepare_product_edit: 'PRODUCT_EDIT',
  quote_order: 'CREATE_ORDER',
  prepare_cancel_order: 'CANCEL_ORDER',
  prepare_payment: 'PAYMENT',
  prepare_refund: 'REFUND',
  prepare_coupon_template: 'COUPON_TEMPLATE_CREATE',
  prepare_coupon_issue: 'COUPON_ISSUE',
  prepare_coupon_template_update: 'COUPON_TEMPLATE_UPDATE',
  prepare_coupon_template_disable: 'COUPON_TEMPLATE_DISABLE',
  prepare_coupon_void: 'COUPON_VOID',
  prepare_seckill_activity: 'CREATE_SECKILL',
  prepare_seckill_toggle: 'SECKILL_TOGGLE',
  ...Object.fromEntries(
    [...CATALOG_OPERATIONS, ...BUSINESS_OPERATIONS].map((d) => [d.key, d.kind]),
  ),
};
export const operationPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    steps: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(100),
            request: z.string().trim().min(1).max(1000),
            tool: z.enum(Object.keys(OPERATION_KINDS) as [string, ...string[]]),
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();
export type OperationPlan = {
  id: string;
  title: string;
  canceled?: boolean;
  steps: { id: string; title: string; request: string; kind: string; actionId?: string }[];
};
@Injectable()
export class OperationPlans {
  constructor(
    private readonly db: PrismaService,
    private readonly actions: AgentActions,
  ) {}
  private async load(user: AuthUser, id: string) {
    const c = await this.db.agentConversation.findFirst({ where: { id, userId: user.id } });
    if (!c) throw new BadRequestException('会话不存在');
    return c;
  }
  async view(user: AuthUser, plan: OperationPlan) {
    const steps = await Promise.all(
      plan.steps.map(async (s) => {
        const action = s.actionId ? await this.actions.detail(user, s.actionId) : undefined;
        return {
          ...s,
          status: action?.status || 'PENDING',
          ...(action?.status === 'SUCCEEDED'
            ? { resourceId: (action.result as { id?: string })?.id }
            : {}),
          action,
        };
      }),
    );
    const next = steps.find((s) => s.status !== 'SUCCEEDED');
    const status = plan.canceled
      ? 'CANCELED'
      : !next
        ? 'SUCCEEDED'
        : ['UNKNOWN', 'EXECUTING'].includes(next.status)
          ? 'CHECK_RESULT'
          : next.status === 'WAITING_CONFIRMATION' && next.action!.expiresAt > new Date()
            ? 'WAITING_CONFIRMATION'
            : steps.some((s) => s.status === 'SUCCEEDED')
              ? 'PARTIAL_COMPLETED'
              : 'READY';
    return {
      id: plan.id,
      title: plan.title,
      status,
      missingFields: [],
      steps: steps.map((s) => ({
        key: s.id,
        title: s.title,
        status: s.status,
        resourceId: s.resourceId,
      })),
      nextPrompt:
        !plan.canceled && next
          ? `继续任务「${plan.title}」的下一步：${next.request}。先查询真实数据，缺信息再问我，完成后只准备确认卡。`
          : undefined,
      action: next?.action,
    };
  }
  async get(user: AuthUser, id: string) {
    const c = await this.load(user, id),
      plan = (c.state as MemberState).operationPlan;
    if (!plan) return null;
    const { action: _, ...view } = await this.view(user, plan);
    void _; // 公共计划不包含原始动作对象，确认卡由独立受保护接口返回。
    return view;
  }
  async prepare(user: AuthUser, ctx: ExecutionContext, input: unknown, state: MemberState) {
    const args = operationPlanSchema.parse(input);
    const allowed = new Set(
      availableCapabilities(user, true)
        .filter((c) => c.requiresApproval)
        .map((c) => c.key),
    );
    if (args.steps.some((s) => !allowed.has(s.tool)))
      throw new ForbiddenException('计划包含当前账号不能操作的业务');
    if (
      state.operationPlan &&
      !['CANCELED', 'SUCCEEDED'].includes((await this.view(user, state.operationPlan)).status)
    )
      throw new ConflictException('已有进行中的任务，请先完成或停止剩余步骤');
    if (state.taskPlan && !state.taskPlan.canceled) {
      const finished =
        state.taskPlan.issueActionId &&
        (await this.actions.detail(user, state.taskPlan.issueActionId)).status === 'SUCCEEDED';
      if (!finished) throw new ConflictException('请先完成或停止当前发券任务');
    }
    if (!ctx.leaseToken) throw new ConflictException('请通过当前会话创建计划');
    const plan: OperationPlan = {
      id: randomUUID(),
      title: args.title,
      steps: args.steps.map((s) => ({ ...s, id: randomUUID(), kind: OPERATION_KINDS[s.tool] })),
    };
    const changed = await this.db.agentConversation.updateMany({
      where: {
        id: ctx.conversationId,
        userId: user.id,
        leaseToken: ctx.leaseToken,
        leaseUntil: { gt: new Date() },
      },
      data: {
        state: JSON.parse(
          JSON.stringify({ ...state, operationPlan: plan }),
        ) as Prisma.InputJsonValue,
      },
    });
    if (!changed.count) throw new ConflictException('会话已变化');
    state.operationPlan = plan;
    const { action: _, ...view } = await this.view(user, plan);
    void _;
    return {
      ok: true,
      plan: view,
      definition:
        '已保存执行计划，尚无业务写入。按顺序逐项查数据、补问、生成确认卡；每一步独立人工确认，完成步骤不重建。',
    };
  }
  async resume(user: AuthUser, id: string, cancel = false) {
    const c = await this.load(user, id),
      state = c.state as MemberState;
    if (!state.operationPlan) throw new BadRequestException('当前会话没有执行计划');
    if (!cancel)
      return {
        ok: true,
        plan: await this.get(user, id),
        ...(await this.view(user, state.operationPlan)),
      };
    const token = randomUUID();
    const claimed = await this.db.agentConversation.updateMany({
      where: {
        id,
        userId: user.id,
        version: c.version,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseToken: token, leaseUntil: new Date(Date.now() + 90000) },
    });
    if (!claimed.count) throw new ConflictException('会话正在处理，请稍后停止');
    try {
      await this.db.$transaction(async (tx) => {
        const ids = state.operationPlan!.steps.flatMap((s) => (s.actionId ? [s.actionId] : []));
        if (ids.length)
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "AgentAction" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`,
          );
        const actions = await tx.agentAction.findMany({
          where: { id: { in: ids }, userId: user.id },
        });
        if (
          actions.length === state.operationPlan!.steps.length &&
          actions.every((a) => a.status === 'SUCCEEDED')
        )
          throw new BadRequestException('任务已完成，没有剩余步骤可停止');
        if (actions.some((a) => ['UNKNOWN', 'EXECUTING'].includes(a.status)))
          throw new ConflictException('有执行结果待核对，停止不等于撤销业务');
        state.operationPlan!.canceled = true;
        await tx.agentAction.updateMany({
          where: { id: { in: ids }, status: 'WAITING_CONFIRMATION', userId: user.id },
          data: { status: 'EXPIRED', version: { increment: 1 } },
        });
        await tx.agentConversation.update({
          where: { id },
          data: { state: JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue },
        });
      });
    } finally {
      await this.db.agentConversation.updateMany({
        where: { id, userId: user.id, leaseToken: token },
        data: { leaseToken: null, leaseUntil: null, version: { increment: 1 } },
      });
    }
    return { ok: true, plan: await this.get(user, id) };
  }
}
