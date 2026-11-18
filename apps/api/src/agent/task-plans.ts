import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/api';
import { PrismaService } from '../prisma/prisma.service';
import { AgentActions, type ExecutionContext } from './actions';
import { ApprovalWorkflow } from './approval-workflow';
import { couponTemplateSchema } from './commerce-schemas';
import { toolError } from './tool-error';
import type { MemberState } from './member-tools';
import { MembersService } from '../members/members.service';
export type CampaignPlan = {
  id: string;
  title: string;
  template: Partial<z.infer<typeof couponTemplateSchema>>;
  memberIds?: string[];
  templateActionId?: string;
  issueActionId?: string;
  canceled?: boolean;
  failure?: string;
};
export const campaignPlanSchema = z
  .object({
    planId: z.string().max(100).optional(),
    title: z.string().trim().min(1).max(100).optional(),
    template: couponTemplateSchema.partial().optional(),
    memberIds: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
  })
  .strict();
const fieldLabels: Record<string, string> = {
  name: '活动名称',
  minimumSpend: '使用门槛',
  discountAmount: '优惠金额',
  startsAt: '开始时间',
  endsAt: '结束时间',
};
@Injectable()
export class TaskPlans {
  constructor(
    private readonly db: PrismaService,
    private readonly actions: AgentActions,
    private readonly workflow: ApprovalWorkflow,
    private readonly members: MembersService,
  ) {}
  private policy(user: AuthUser) {
    if (
      !['member:view', 'member:coupon-issue'].every((p) => user.permissions.includes(p)) ||
      !user.roles.some((r) => r.dataScope === 'ALL')
    )
      throw new ForbiddenException('此任务需要全平台会员与发券管理权限');
  }
  private async load(user: AuthUser, id: string) {
    const c = await this.db.agentConversation.findFirst({ where: { id, userId: user.id } });
    if (!c) throw new BadRequestException('会话不存在');
    return c;
  }
  private async inspect(user: AuthUser, plan: CampaignPlan) {
    const first = plan.templateActionId
      ? await this.actions.detail(user, plan.templateActionId)
      : undefined;
    const second = plan.issueActionId
      ? await this.actions.detail(user, plan.issueActionId)
      : undefined;
    const created = first?.status === 'SUCCEEDED',
      issued = second?.status === 'SUCCEEDED';
    const missing = created
      ? plan.memberIds?.length
        ? []
        : ['发券会员（请查询并明确选择）']
      : Object.keys(fieldLabels)
          .filter((k) => !plan.template[k as keyof typeof plan.template])
          .map((k) => fieldLabels[k]);
    const current = created ? second : first;
    const status = plan.canceled
      ? 'CANCELED'
      : issued
        ? 'SUCCEEDED'
        : current?.status === 'UNKNOWN' || current?.status === 'EXECUTING'
          ? 'CHECK_RESULT'
          : current?.status === 'WAITING_CONFIRMATION' && current.expiresAt > new Date()
            ? 'WAITING_CONFIRMATION'
            : created
              ? 'PARTIAL_COMPLETED'
              : missing.length
                ? 'NEEDS_INPUT'
                : 'READY';
    return {
      id: plan.id,
      title: plan.title,
      status,
      missingFields: missing,
      failure: plan.failure,
      steps: [
        {
          key: 'template',
          title: '创建满减券模板',
          status: created ? 'SUCCEEDED' : first?.status || 'PENDING',
          resourceId: created ? (first.result as { id: string }).id : undefined,
          actionId: first?.id,
        },
        {
          key: 'issue',
          title: '向指定会员发券',
          status: issued ? 'SUCCEEDED' : second?.status || 'PENDING',
          actionId: second?.id,
        },
      ],
      definition: '每步独立确认；创建模板不自动发券。停止任务不撤销已完成业务。',
    };
  }
  async get(user: AuthUser, conversationId: string) {
    const c = await this.load(user, conversationId);
    const plan = (c.state as MemberState).taskPlan;
    return plan ? this.inspect(user, plan) : null;
  }
  private async save(user: AuthUser, ctx: ExecutionContext, state: MemberState) {
    if (!ctx.leaseToken) throw new ConflictException('任务写入需要当前会话租约');
    const persisted = (await this.load(user, ctx.conversationId)).state as MemberState;
    if (state.taskPlan && persisted.taskPlan?.id === state.taskPlan.id) {
      if (persisted.taskPlan.templateActionId)
        state.taskPlan.templateActionId = persisted.taskPlan.templateActionId;
      if (persisted.taskPlan.issueActionId)
        state.taskPlan.issueActionId = persisted.taskPlan.issueActionId;
    }
    const changed = await this.db.agentConversation.updateMany({
      where: {
        id: ctx.conversationId,
        userId: user.id,
        leaseToken: ctx.leaseToken,
        leaseUntil: { gt: new Date() },
      },
      data: { state: JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue },
    });
    if (!changed.count) throw new ConflictException('会话已变化，请重新打开任务');
  }
  // 【任务规划】只保存任务与预览；业务写入继续经过原确认图和业务Service。
  async prepare(user: AuthUser, ctx: ExecutionContext, input: unknown, state: MemberState) {
    this.policy(user);
    if (state.operationPlan && !state.operationPlan.canceled) {
      const ids = state.operationPlan.steps.map((s) => s.actionId).filter((v): v is string => !!v);
      const done = await this.db.agentAction.count({
        where: { id: { in: ids }, userId: user.id, status: 'SUCCEEDED' },
      });
      if (done !== state.operationPlan.steps.length)
        throw new ConflictException('请先完成或停止当前跨业务执行计划');
    }
    const args = campaignPlanSchema.parse(input);
    const previous = state.taskPlan;
    if (args.planId && previous?.id !== args.planId)
      throw new ConflictException('任务编号不属于当前会话');
    if (
      previous &&
      !args.planId &&
      (await this.inspect(user, previous)).status !== 'SUCCEEDED' &&
      !previous.canceled
    )
      throw new ConflictException('已有未完成任务，请用其planId补充信息或先停止剩余步骤');
    const plan: CampaignPlan = args.planId
      ? { ...previous! }
      : { id: randomUUID(), title: args.title || '创建满减券并向指定会员发放', template: {} };
    const first = plan.templateActionId
      ? await this.actions.detail(user, plan.templateActionId)
      : undefined;
    const second = plan.issueActionId
      ? await this.actions.detail(user, plan.issueActionId)
      : undefined;
    if (plan.canceled) throw new ConflictException('任务已停止，请新建任务');
    const waiting = first?.status === 'SUCCEEDED' ? second : first;
    if (
      !args.template &&
      !args.memberIds &&
      !args.title &&
      waiting?.status === 'WAITING_CONFIRMATION' &&
      waiting.expiresAt > new Date()
    )
      return { ok: true, plan: await this.inspect(user, plan), action: waiting };
    if ([first, second].some((a) => a && ['EXECUTING', 'UNKNOWN'].includes(a.status)))
      return {
        ok: true,
        plan: await this.inspect(user, plan),
        action: second?.status === 'UNKNOWN' || second?.status === 'EXECUTING' ? second : first,
      };
    if (
      args.template &&
      first?.status === 'SUCCEEDED' &&
      Object.entries(args.template).some(
        ([k, v]) => plan.template[k as keyof typeof plan.template] !== v,
      )
    )
      throw new ConflictException('模板已创建，修改规则需另起模板修改确认，不能重建已完成步骤');
    if (second?.status === 'SUCCEEDED') return { ok: true, plan: await this.inspect(user, plan) };
    if (args.title) plan.title = args.title;
    if (args.template) plan.template = { ...plan.template, ...args.template };
    if (args.memberIds) plan.memberIds = [...new Set(args.memberIds)].sort();
    delete plan.failure;
    state.taskPlan = plan;
    await this.save(user, ctx, state);
    let action;
    try {
      if (first?.status !== 'SUCCEEDED') {
        if (plan.memberIds?.length) {
          const targets = await Promise.all(plan.memberIds.map((id) => this.members.detail(id)));
          if (targets.some((m) => !m.enabled))
            throw new BadRequestException('目标包含停用会员，请重新选择发券对象');
        }
        if (Object.keys(fieldLabels).every((k) => plan.template[k as keyof typeof plan.template])) {
          action = (
            await this.actions.prepareCommerce(
              user,
              { ...ctx, taskLink: { planId: plan.id, field: 'templateActionId' } },
              'COUPON_TEMPLATE_CREATE',
              couponTemplateSchema.parse(plan.template),
            )
          ).action;
          plan.templateActionId = action.id;
        }
      } else if (plan.memberIds?.length) {
        action = (
          await this.actions.prepareCommerce(
            user,
            { ...ctx, taskLink: { planId: plan.id, field: 'issueActionId' } },
            'COUPON_ISSUE',
            {
              templateId: (first.result as { id: string }).id,
              memberIds: plan.memberIds,
            },
          )
        ).action;
        plan.issueActionId = action.id;
      }
      if (action) {
        state.lastActionId = action.id;
        await this.workflow.prepare(user, action.id);
      }
    } catch (error) {
      plan.failure = toolError(error).message;
    }
    await this.save(user, ctx, state);
    return {
      ok: !plan.failure,
      plan: await this.inspect(user, plan),
      ...(action ? { action } : {}),
    };
  }
  // 【无模型续接】领取会话租约后从实际动作结果续接，只准备下一步，绝不自动批准。
  async resume(user: AuthUser, conversationId: string, cancel = false) {
    if (!cancel) this.policy(user);
    const c = await this.load(user, conversationId),
      state = c.state as MemberState;
    if (!state.taskPlan) throw new BadRequestException('当前会话没有任务');
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
    if (!claim.count) throw new ConflictException('会话正在处理，请稍后续接');
    try {
      if (cancel) {
        const view = await this.inspect(user, state.taskPlan);
        if (view.status === 'SUCCEEDED')
          throw new BadRequestException('任务已完成，没有剩余步骤可停止');
        if (view.status === 'CHECK_RESULT')
          throw new ConflictException('执行结果待核对，不能将停止任务当作撤销业务');
        const ids = [state.taskPlan.templateActionId, state.taskPlan.issueActionId].filter(
          (v): v is string => !!v,
        );
        await this.db.$transaction(async (tx) => {
          if (ids.length)
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "AgentAction" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`,
            );
          const current = await tx.agentAction.findMany({
            where: { id: { in: ids }, userId: user.id },
          });
          if (current.some((a) => ['EXECUTING', 'UNKNOWN'].includes(a.status)))
            throw new ConflictException('当前操作结果待核对，不能撤销已提交业务');
          if (
            current.some((a) => a.id === state.taskPlan!.issueActionId && a.status === 'SUCCEEDED')
          )
            throw new BadRequestException('任务已完成');
          state.taskPlan!.canceled = true;
          await tx.agentAction.updateMany({
            where: { id: { in: ids }, userId: user.id, status: 'WAITING_CONFIRMATION' },
            data: { status: 'EXPIRED', version: { increment: 1 } },
          });
          const changed = await tx.agentConversation.updateMany({
            where: { id: conversationId, userId: user.id, leaseToken },
            data: { state: JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue },
          });
          if (!changed.count) throw new ConflictException('会话已变化');
        });
        return { ok: true, plan: await this.inspect(user, state.taskPlan) };
      }
      const run = await this.db.agentRun.create({ data: { userId: user.id, conversationId } });
      const result = await this.prepare(
        user,
        { conversationId, runId: run.id, credential: '', leaseToken },
        { planId: state.taskPlan.id },
        state,
      );
      await this.db.agentRun.update({
        where: { id: run.id },
        data: {
          status: result.plan.status,
          state: JSON.parse(JSON.stringify(result.plan)) as Prisma.InputJsonValue,
        },
      });
      return result;
    } finally {
      await this.db.agentConversation.updateMany({
        where: { id: c.id, userId: user.id, leaseToken },
        data: { leaseToken: null, leaseUntil: null, version: { increment: 1 } },
      });
    }
  }
}
