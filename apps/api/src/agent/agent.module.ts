import { TaskPlans } from './task-plans';
import { MediaInputController, MediaInputService } from './media-input';
import { recordExecution, type ExecutionEvent } from './execution-progress';
import { OperationPlans } from './operation-plans';
import { visibleAction } from './visibility';
import { topLevelActionIds } from './batch-operations';
import { canInspectAgent, visibleReply, visibleConversation, type ToolTrace } from './visibility';
import { summaryPeriod } from './summary-period';
import { availableCapabilities } from './capability-registry';
import { Prisma } from '@prisma/client';
import { ApprovalWorkflow } from './approval-workflow';
import { MemberBenefitsModule } from '../member-benefits/member-benefits.module';
import { conversationGuide } from './capabilities';
import { AgentActions, type ExecutionContext } from './actions';
import { Req } from '@nestjs/common';
import type { Request } from 'express';
import { extractJwtToken } from '../auth/auth';
import { KnowledgeService } from './knowledge/knowledge.service';
import { ConflictException } from '@nestjs/common';
import { runRetailQuery } from './query-agent';
import { MemberTools, type MemberState, memberIdSchema } from './member-tools';
import { ConversationsService } from './conversations';
import { Delete, Param } from '@nestjs/common';
import { Res } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser, RequirePermissions } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { MetricsService, ResourcesModule } from '../modules/resources';
import { MembersModule } from '../members/member.module';
import { MembersService } from '../members/members.service';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export const toolNames = [
  'query_sales_summary',
  'query_member_statistics',
  'query_campaign_performance',
  'query_payment_summary',
] as const;
type ToolName = (typeof toolNames)[number];
export class AgentDto {
  @IsOptional() @IsString() @MaxLength(100) conversationId?: string;
  @IsString() @MinLength(1) @MaxLength(2000) message!: string;
  @IsOptional() @IsInt() @Min(1) @Max(90) days: number = 30;
  @IsOptional() @IsIn(toolNames) tool?: ToolName;
}
type Evidence = { name: string; arguments: { days: number }; result: unknown; queriedAt: string };

@Injectable()
export class AgentService {
  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly members: MembersService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly db: PrismaService,
    private readonly memberTools: MemberTools,
    private readonly knowledge: KnowledgeService,
    private readonly actions: AgentActions,
    private readonly plans?: TaskPlans,
    private readonly operationPlans?: OperationPlans,
  ) {}

  database() {
    return this.db;
  }
  memberPolicy(user: AuthUser) {
    this.memberTools.policy(user);
  }
  status() {
    return {
      configured: Boolean(this.config.get('AGENT_API_KEY') && this.config.get('AGENT_MODEL')),
      tools: toolNames,
      capabilities: {
        personalMembers: true,
        knowledgeConfigured: Boolean(this.config.get('KNOWLEDGE_DATABASE_URL')),
        writesEnabled: this.config.get('AGENT_WRITES_ENABLED', 'false') === 'true',
      },
    };
  }

  // 【权限】模型只能从服务端白名单挑选工具，每次执行重新检查权限，不能指定用户或SQL。
  async execute(user: AuthUser, name: string, args: unknown, requestId: string): Promise<Evidence> {
    if (!toolNames.includes(name as ToolName)) throw new BadRequestException('不支持的只读工具');
    const { days, start, end, q } = summaryPeriod(args);
    const permissions =
      name === 'query_member_statistics'
        ? ['member:view']
        : name === 'query_campaign_performance'
          ? ['order:view', 'seckill:view']
          : name === 'query_payment_summary'
            ? ['order:view']
            : ['dashboard:view'];
    if (
      !user.permissions.includes('dashboard:view') ||
      !permissions.every((p) => user.permissions.includes(p))
    )
      throw new ForbiddenException('没有此业务工具的查询权限');
    // 会员档案没有门店归属字段，限制全平台会员聚合为ALL范围的管理者。
    if (name === 'query_member_statistics' && !user.roles.some((r) => r.dataScope === 'ALL'))
      throw new ForbiddenException('全平台会员统计仅供全数据范围管理者使用');
    try {
      let result: unknown;
      if (name === 'query_sales_summary') {
        const [summary, charts] = await Promise.all([
          this.metrics.overview(user, q),
          this.metrics.charts(user, q),
        ]);
        const { activeStores, growthRate, ...sales } = summary;
        result = {
          ...sales,
          operatingStoreCount: activeStores,
          periodOverPeriodGrowthPercent: growthRate,
          growthDefinition:
            '等长上期环比（不是去年同期同比）。本期与紧邻上一个等长日期窗口比较；无上期基数时返回null。',
          operatingStoreCountDefinition:
            '在营门店数=启用且未删除的门店数；不是动销门店数。本工具未计算动销门店数，不得声称只有这些门店有成交。',
          productRanking: charts.productRanking,
          productRankingLimit: 6,
          productRankingComplete: false,
          productRankingDefinition:
            '仅前6名展示，不是全部商品；榜外单品用query_product_sales按真实商品ID查询，不能把未上榜当零销量。',
          salesTrend: charts.trend,
          storeRanking: charts.storeRanking,
          categoryDistribution: charts.categoryShare,
          hourlyDistribution: charts.hourly,
          period: q,
          definition:
            '按上海时区订单创建日期统计已完成且未退款订单（含历史导入），销量按件；分类金额为商品行原价，非实付分摊。',
        };
      } else if (name === 'query_member_statistics')
        result = await this.members.statistics(start, end);
      else if (name === 'query_campaign_performance')
        result = await this.orders.campaignPerformance(user, start, end);
      else result = await this.payments.statistics(user, start, end);
      result = { period: q, ...(result as Record<string, unknown>) };
      // 【审计】调用成功必须落库；日志只存工具名与范围，不存会员隐私或密钥。
      await this.db.operationLog.create({
        data: {
          userId: user.id,
          module: 'agent',
          action: `${name} days=${days} request=${requestId}`,
          method: 'TOOL',
          path: '/agent/chat',
          success: true,
        },
      });
      return { name, arguments: { days }, result, queriedAt: new Date().toISOString() };
    } catch (error) {
      await this.db.operationLog.create({
        data: {
          userId: user.id,
          module: 'agent',
          action: `${name} request=${requestId}`,
          method: 'TOOL',
          path: '/agent/chat',
          success: false,
          error: '工具查询失败',
        },
      });
      throw error;
    }
  }

  async chat(
    user: AuthUser,
    dto: AgentDto,
    emit?: (event: string, data: unknown) => void,
    signal?: AbortSignal,
    history: { role: string; content: string }[] = [],
    state: MemberState = {},
    execution?: ExecutionContext,
  ) {
    const requestId = randomUUID();
    const evidence: Evidence[] = [];
    // 【确定性查询】显式工具卡始终可用；不把它冒充模型Tool Calling。
    if (dto.tool) {
      if (execution)
        await recordExecution(this.db, execution.runId, {
          title: '执行快捷业务查询',
          detail: `直接调用 ${dto.tool}，本次不经过语言模型。`,
          technologies: ['NestJS Service', 'Prisma / PostgreSQL'],
          status: 'RUNNING',
        });
      evidence.push(await this.execute(user, dto.tool, { days: dto.days }, requestId));
      return {
        requestId,
        mode: 'direct',
        answer: '已从业务服务查询实时数据，请查看下方查询凭据。此模式未调用语言模型。',
        evidence,
      };
    }
    const guide = conversationGuide(dto.message, user, this.status().capabilities.writesEnabled);
    if (guide) {
      emit?.('delta', { text: guide });
      return { requestId, mode: 'guide', answer: guide, evidence: [], state };
    }
    if (!this.status().configured)
      throw new ServiceUnavailableException(
        '尚未配置模型。请使用业务工具卡查询真实数据，或在API环境中配置AGENT_API_KEY、AGENT_MODEL、AGENT_BASE_URL。',
      );
    let allowSuggestedSeckill =
      /秒杀/.test(dto.message) &&
      /(分析|推荐|制定|策划|设计|规划|自行|建议|帮我选)/.test(dto.message) &&
      /(创建|生成|制定|设计|策划|准备|安排|规划|做)/.test(dto.message);
    if (
      !allowSuggestedSeckill &&
      state.lastActionId &&
      /(修改|调整|改成|换|改价|更改)/.test(dto.message)
    ) {
      const previous = await this.actions.detail(user, state.lastActionId);
      allowSuggestedSeckill =
        previous.kind === 'CREATE_SECKILL' &&
        !!(previous.payload as { proposal?: unknown }).proposal &&
        ['WAITING_CONFIRMATION', 'EXPIRED'].includes(previous.status);
    }
    const result = await runRetailQuery({
      apiKey: this.config.get<string>('AGENT_API_KEY')!,
      writesEnabled: this.status().capabilities.writesEnabled,
      model: this.config.get<string>('AGENT_MODEL')!,
      baseURL: this.config.get<string>('AGENT_BASE_URL'),
      user,
      members: this.memberTools,
      knowledge: this.knowledge,
      actions: this.actions,
      plans: this.plans,
      operationPlans: this.operationPlans,
      execution: execution
        ? {
            ...execution,
            entities: state,
            allowSuggestedSeckill,
          }
        : undefined,
      progress: execution
        ? async (event) => {
            const item = await recordExecution(this.db, execution.runId, event);
            emit?.('execution_step', item);
          }
        : undefined,
      state,
      message: dto.message,
      days: dto.days,
      history,
      emit,
      signal,
      summary: (name, args) => this.execute(user, name, args, requestId),
      freshUser: async () => {
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
        if (!updated.permissions.includes('dashboard:view'))
          throw new ForbiddenException('权限已撤销');
        // 摘要工具闭包使用同一对象，避免长任务沿用旧权限。
        Object.assign(user, updated);
        return updated;
      },
      audit: async (name, ok, evidence, trace) => {
        if (execution) {
          // 【持久化步骤】逐工具保存脱敏结果和实体状态，聊天文本仅作展示投影。
          await this.db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "id" = ${execution.runId} FOR UPDATE`;
            const run = await tx.agentRun.findUniqueOrThrow({ where: { id: execution.runId } });
            const previous = run.state as { checkpoints?: unknown[]; trace?: ToolTrace[] };
            await tx.agentToolInvocation.create({
              data: { runId: execution.runId, actorId: user.id, toolName: name, success: ok },
            });
            await tx.agentRun.update({
              where: { id: execution.runId },
              data: {
                state: JSON.parse(
                  JSON.stringify({
                    ...previous,
                    phase: 'TOOL_COMPLETED',
                    trace: [...(previous.trace || []), ...(trace ? [trace] : [])].sort(
                      (a, b) => a.sequence - b.sequence,
                    ),
                    entities: state,
                    checkpoints: [...(previous.checkpoints || []), evidence || { name, ok }].slice(
                      -8,
                    ),
                  }),
                ) as Prisma.InputJsonValue,
                version: { increment: 1 },
              },
            });
          });
        }
        return this.db.operationLog
          .create({
            data: {
              userId: user.id,
              module: 'agent',
              action: name + ' request=' + requestId,
              method: 'TOOL',
              path: '/agent/chat',
              success: ok,
            },
          })
          .then(() => undefined);
      },
    });
    return { requestId, mode: 'model', ...result };
  }
}

@Controller('agent')
@RequirePermissions('dashboard:view')
class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly conversations: ConversationsService,
    private readonly actions: AgentActions,
    private readonly workflow: ApprovalWorkflow,
    private readonly plans: TaskPlans,
    private readonly operationPlans: OperationPlans,
  ) {}
  @Get('conversations') list(@CurrentUser() user: AuthUser) {
    return this.conversations.list(user.id);
  }
  @Post('conversations') create(@CurrentUser() user: AuthUser) {
    return this.conversations.create(user.id);
  }
  @Get('conversations/:id') async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const item = await this.conversations.detail(user.id, id);
    const lastRun = canInspectAgent(user)
      ? await this.agent.database().agentRun.findFirst({
          where: { conversationId: id, userId: user.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
      : null;
    return visibleConversation(user, { ...item, lastRunId: lastRun?.id });
  }
  @Delete('conversations/:id') remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.remove(user.id, id);
  }
  @Get('capabilities') capabilities(@CurrentUser() user: AuthUser) {
    return availableCapabilities(user, this.agent.status().capabilities.writesEnabled);
  }
  @Get('status') status(@CurrentUser() user: AuthUser) {
    return { ...this.agent.status(), traceEnabled: canInspectAgent(user) };
  }
  // 【流式接口】认证与DTO校验在响应建立前执行；错误事件明确标记，断开连接停止上游请求。
  @Post('chat/stream')
  async stream(
    @CurrentUser() user: AuthUser,
    @Body() dto: AgentDto,
    @Res() res: ExpressResponse,
    @Req() req: Request,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const send = (event: string, data: unknown) => {
      if (!res.destroyed) res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    };
    try {
      send('status', { text: '正在查询业务服务…' });
      const result = await this.application(
        user,
        dto,
        send,
        controller.signal,
        this.credential(req),
      );
      send('done', result);
    } catch (error) {
      send('error', { message: error instanceof Error ? error.message : '查询失败' });
    } finally {
      res.end();
    }
  }
  // 【统一应用入口】流式、非流式均检查所有权、领取会话租约、恢复结构化实体并保存历史。
  private async application(
    user: AuthUser,
    dto: AgentDto,
    emit?: (event: string, data: unknown) => void,
    signal?: AbortSignal,
    credential = '',
  ) {
    const emitVisible = (event: string, data: unknown) => {
      if (['tool_start', 'tool_trace', 'execution_step'].includes(event) && !canInspectAgent(user))
        return;
      if (event === 'evidence') data = visibleReply(user, { evidence: [data] }).evidence?.[0];
      if (event === 'tool_error' && !canInspectAgent(user)) {
        const value = data as { message: string; code: string };
        data = { message: value.message, code: value.code };
      }
      emit?.(event, data);
    };
    const conversation = dto.conversationId
      ? await this.conversations.detail(user.id, dto.conversationId)
      : await this.conversations.create(user.id);
    const leaseToken = randomUUID();
    const db = this.agent.database();
    const claim = await db.agentConversation.updateMany({
      where: {
        id: conversation.id,
        userId: user.id,
        version: conversation.version,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseToken, leaseUntil: new Date(Date.now() + 90000) },
    });
    if (!claim.count) throw new ConflictException('此会话正在处理，请稍后重试');
    const run = await db.agentRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        state: JSON.parse(JSON.stringify(conversation.state)) as Prisma.InputJsonValue,
      },
    });
    emit?.('run', { runId: run.id });
    await recordExecution(db, run.id, {
      title: '接收任务并建立本次执行',
      detail: '已通过登录与后台权限校验，绑定当前用户和会话，创建运行记录。',
      technologies: ['NestJS Controller', 'JWT / RBAC', 'Prisma / PostgreSQL'],
      status: 'SUCCEEDED',
    });
    await db.agentAction.updateMany({
      where: {
        userId: user.id,
        conversationId: conversation.id,
        status: 'WAITING_CONFIRMATION',
        id: { in: await topLevelActionIds(db, user.id, conversation.id) },
      },
      data: { status: 'EXPIRED', version: { increment: 1 } },
    });
    try {
      const turns = conversation.messages as unknown as {
        question: string;
        reply: { answer: string };
      }[];
      const history = turns.slice(-12).flatMap((t) => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.reply.answer },
      ]);
      const state = conversation.state as MemberState;
      await recordExecution(db, run.id, {
        title: '加载会话上下文',
        detail: `读取最近 ${Math.min(turns.length, 12)} 轮对话及已选实体、任务状态；领取会话租约以避免并发覆盖。`,
        technologies: ['PostgreSQL · 会话持久化', '会话版本 / 租约'],
        status: 'SUCCEEDED',
      });
      const result = await this.agent.chat(user, dto, emitVisible, signal, history, state, {
        conversationId: conversation.id,
        runId: run.id,
        leaseToken,
        credential,
      });
      await this.conversations.save(
        user.id,
        conversation.id,
        conversation.version,
        dto.message,
        { ...result, runId: run.id },
        'state' in result ? result.state : state,
        leaseToken,
      );
      const pending = await db.agentAction.findMany({
        where: {
          runId: run.id,
          status: 'WAITING_CONFIRMATION',
          id: { in: await topLevelActionIds(db, user.id, conversation.id, run.id) },
        },
        select: { id: true },
      });
      for (const action of pending) await this.workflow.prepare(user, action.id);
      await recordExecution(db, run.id, {
        title: pending.length ? '草稿已就绪，等待管理员确认' : '本轮答复已完成',
        detail: pending.length
          ? '已冻结草稿、内容hash和版本；等待专用确认卡批准，尚未执行业务写入。'
          : '查询结果或直接答复已返回；本轮没有待批准的业务写入。',
        technologies: pending.length
          ? ['LangGraph · interrupt', 'PostgresSaver · 检查点', 'AgentAction · hash/版本']
          : ['SSE', '会话持久化'],
        status: pending.length ? 'WAITING' : 'SUCCEEDED',
      });
      const priorRun = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
      await db.agentRun.update({
        where: { id: run.id },
        data: {
          status: pending.length ? 'WAITING_CONFIRMATION' : 'SUCCEEDED',
          state: JSON.parse(
            JSON.stringify({
              ...result,
              trace: (priorRun.state as { trace?: unknown[] }).trace || [],
              events: (priorRun.state as { events?: ExecutionEvent[] }).events || [],
            }),
          ) as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      return visibleReply(user, { ...result, conversationId: conversation.id, runId: run.id });
    } catch (error) {
      await recordExecution(db, run.id, {
        title: '本轮执行中断',
        detail: '处理未完成；已提交的动作以业务台账为准，不自动重复写入。',
        technologies: ['NestJS · 异常处理', 'AgentRun / AgentAction'],
        status: 'FAILED',
      });
      await db.agentRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', version: { increment: 1 } },
      });
      throw error;
    } finally {
      await db.agentConversation.updateMany({
        where: { id: conversation.id, userId: user.id, leaseToken },
        data: { leaseToken: null, leaseUntil: null },
      });
    }
  }
  @Get('conversations/:id/task-plan') taskPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.plans.get(user, id);
  }
  @Get('conversations/:id/operation-plan') operationPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.operationPlans.get(user, id);
  }
  @Post('conversations/:id/operation-plan/resume') async resumeOperations(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const result = await this.operationPlans.resume(user, id);
    return {
      ...result,
      ...('action' in result && result.action
        ? { action: visibleAction(user, result.action) }
        : {}),
    };
  }
  @Post('conversations/:id/operation-plan/cancel') cancelOperations(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.operationPlans.resume(user, id, true);
  }
  @Post('conversations/:id/task-plan/resume') async resumeTask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const result = await this.plans.resume(user, id);
    return {
      ...result,
      ...('action' in result && result.action
        ? { action: visibleAction(user, result.action) }
        : {}),
    };
  }
  @Post('conversations/:id/task-plan/cancel') cancelTask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.plans.resume(user, id, true);
  }
  @Post('conversations/:id/select-member')
  async select(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: unknown) {
    const { memberId } = memberIdSchema.parse(input);
    this.agent.memberPolicy(user);
    const c = await this.conversations.detail(user.id, id);
    const state = c.state as MemberState;
    if (!state.candidateIds?.includes(memberId))
      throw new BadRequestException('请选择当前会话候选列表中的会员');
    const changed = await this.agent.database().agentConversation.updateMany({
      where: {
        id,
        userId: user.id,
        version: c.version,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: {
        state: { ...state, selectedMemberId: memberId, candidateIds: [] },
        version: { increment: 1 },
      },
    });
    if (!changed.count) throw new ConflictException('会话已变化，请刷新后再选择');
    return { selectedMemberId: memberId };
  }
  private credential(req: Request) {
    return extractJwtToken(req, process.env.COOKIE_NAME || 'sunny_session') || '';
  }
  @Get('runs/:id') async run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const row = await this.agent.database().agentRun.findFirst({ where: { id, userId: user.id } });
    if (!row) throw new BadRequestException('任务不存在');
    const publicRow = {
      id: row.id,
      conversationId: row.conversationId,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (row.status === 'RUNNING' && row.updatedAt.getTime() < Date.now() - 90000)
      return { ...publicRow, status: 'INTERRUPTED' };
    return publicRow;
  }
  // 【执行明细接口】角色检查在后端执行，普通账号即使猜到runId也不能读取。
  @Get('runs/:id/trace') async trace(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!canInspectAgent(user)) throw new ForbiddenException('仅管理员可查看Agent执行过程');
    const run = await this.agent.database().agentRun.findFirst({ where: { id, userId: user.id } });
    if (!run) throw new BadRequestException('任务不存在');
    await this.conversations.detail(user.id, run.conversationId);
    const calls = await this.agent
      .database()
      .agentToolInvocation.findMany({ where: { runId: id }, orderBy: { createdAt: 'asc' } });
    const actions = await this.agent.database().agentAction.findMany({
      where: { runId: id, userId: user.id },
      select: {
        id: true,
        kind: true,
        status: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      runId: id,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      trace: (run.state as { trace?: ToolTrace[] }).trace || [],
      events: (run.state as { events?: ExecutionEvent[] }).events || [],
      evidence:
        (run.state as { evidence?: unknown[]; checkpoints?: unknown[] }).evidence ||
        (run.state as { checkpoints?: unknown[] }).checkpoints ||
        [],
      calls,
      actions: await Promise.all(
        actions.map(async (action) => ({
          ...action,
          workflow: await this.workflow
            .progress(user, action.id)
            .catch(() => ({ phase: 'CHECKPOINT_UNAVAILABLE', nextNodes: [] })),
        })),
      ),
      mcp: { connected: false, note: '当前未接入MCP，不生成虚假调用记录' },
    };
  }
  @Get('actions/:id') async action(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.actions.flushAudit();
    return visibleAction(user, await this.actions.detail(user, id));
  }
  @Post('actions/:id/seckill-proposal') async reviseSeckill(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const result = await this.actions.reviseSeckill(user, id, input, this.credential(req));
    await this.workflow.prepare(user, result.action.id);
    await recordExecution(this.agent.database(), result.action.runId, {
      title: '按管理员修改生成新方案草稿',
      detail: '原确认卡已失效；新参数已重新校验并进入等待确认。尚未发布活动。',
      technologies: ['Zod', 'AgentAction · hash/版本', 'LangGraph · interrupt'],
      status: 'WAITING',
    });
    return visibleAction(user, result.action);
  }
  @Post('actions/:id/confirm') async confirm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const before = await this.actions.detail(user, id);
    await recordExecution(this.agent.database(), before.runId, {
      title: '收到管理员确认请求',
      detail: '开始核对当前身份、内容hash、版本、有效期与动作状态。',
      technologies: ['JWT / RBAC', 'Zod', 'AgentAction · 幂等台账'],
      status: 'RUNNING',
    });
    const result = await this.workflow
      .decide(user, id, input, this.credential(req))
      .catch(async (error) => {
        await recordExecution(this.agent.database(), before.runId, {
          title: '本次确认未完成',
          detail: '确认被业务校验拒绝或执行异常；请以当前动作状态核对结果，系统不会绕过校验重发。',
          technologies: ['LangGraph / AgentAction', '业务校验与异常处理'],
          status: 'FAILED',
        });
        throw error;
      });
    const batchOutcome = ['BATCH_CREATE_ORDERS', 'BATCH_OPERATIONS'].includes(result.kind)
      ? (result.result as { succeeded?: number; failed?: number; pending?: number } | null)
      : null;
    await recordExecution(this.agent.database(), before.runId, {
      title:
        batchOutcome?.failed && result.status === 'SUCCEEDED'
          ? '批次已处理，存在未创建订单'
          : before.status === 'SUCCEEDED'
            ? '复用已完成动作结果'
            : result.status === 'SUCCEEDED'
              ? '管理员批准后业务执行完成'
              : result.status === 'REJECTED'
                ? '管理员已拒绝草稿'
                : '确认操作已处理',
      detail: batchOutcome
        ? `批次状态：${result.status}；已创建${batchOutcome.succeeded || 0}笔，未创建${batchOutcome.failed || 0}笔，待核对/处理${batchOutcome.pending || 0}笔。结果来自业务台账。`
        : `动作 ${result.kind} 当前状态：${result.status}。结果来自业务台账。`,
      technologies:
        before.status === 'SUCCEEDED'
          ? ['AgentAction · 已保存结果', '业务幂等']
          : [
              'LangGraph · Command/resume',
              result.kind === 'CREATE_SECKILL'
                ? 'NestJS · SeckillService.create'
                : 'NestJS Service',
              'Prisma / PostgreSQL',
              '业务幂等 / 审计',
            ],
      status: batchOutcome?.failed
        ? 'FAILED'
        : result.status === 'SUCCEEDED' || result.status === 'REJECTED'
          ? 'SUCCEEDED'
          : result.status === 'FAILED'
            ? 'FAILED'
            : 'WAITING',
    });
    return visibleAction(user, result);
  }
  @Post('chat') chat(@CurrentUser() user: AuthUser, @Body() dto: AgentDto, @Req() req: Request) {
    return this.application(user, dto, undefined, undefined, this.credential(req));
  }
}
@Module({
  imports: [ResourcesModule, MembersModule, OrdersModule, PaymentsModule, MemberBenefitsModule],
  controllers: [AgentController, MediaInputController],
  providers: [
    AgentService,
    MediaInputService,
    ConversationsService,
    MemberTools,
    KnowledgeService,
    AgentActions,
    ApprovalWorkflow,
    TaskPlans,
    OperationPlans,
  ],
  exports: [AgentService],
})
export class AgentModule {}
