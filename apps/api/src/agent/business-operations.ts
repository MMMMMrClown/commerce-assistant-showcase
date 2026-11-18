import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../common/api';
import { validateTierRules, type MemberTierRule } from '../member-benefits/benefit-rules';

const id = z.string().min(1).max(100);
const reason = z.string().trim().min(2).max(200);
const tier = z.enum(['STANDARD', 'SPROUT', 'VIP', 'GOLD', 'PLATINUM', 'DIAMOND']);
const tierChange = z
  .object({
    code: tier,
    name: z.string().trim().min(2).max(20).optional(),
    minimumSpend: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/)
      .optional(),
    discountBps: z.number().int().min(5000).max(10000).optional(),
    pointsPerYuan: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export const BUSINESS_OPERATIONS = [
  {
    key: 'prepare_benefit_policy',
    kind: 'BENEFIT_POLICY',
    label: '修改会员权益规则',
    permissions: ['member:view', 'member:benefits-manage'],
    description:
      '修改全平台权益启停或指定等级规则，自动保留其他等级，须说明原因。折扣以万分比输入：9500为95折；不猜门槛或权益。',
    schema: z
      .object({
        enabled: z.boolean().optional(),
        changes: z.array(tierChange).min(1).max(6).optional(),
        reason,
      })
      .strict()
      .refine((v) => v.enabled !== undefined || !!v.changes?.length, '请提供修改项'),
  },
  {
    key: 'prepare_member_tier',
    kind: 'MEMBER_TIER',
    label: '调整会员等级',
    permissions: ['member:view', 'member:benefits-manage'],
    description: '仅为已选会员设置手动等级或传null恢复自动等级，须说明原因；不是改积分或消费额。',
    schema: z.object({ memberId: id, tierOverride: tier.nullable(), reason }).strict(),
  },
  {
    key: 'prepare_import_confirm',
    kind: 'IMPORT_CONFIRM',
    label: '确认历史订单导入',
    permissions: ['data-import:view', 'data-import:create'],
    description:
      '对已通过原CSV上传接口校验的READY任务生成导入确认卡。先查询任务，不能编造文件或订单数据；不能重新导入已完成任务。',
    schema: z.object({ importId: id }).strict(),
  },
  {
    key: 'prepare_metric_status',
    kind: 'METRIC_STATUS',
    label: '指标启停',
    permissions: ['metric:view', 'metric:edit'],
    description:
      '先查真实指标定义，准备启用或停用确认卡，仅改变原系统指标展示开关，不修改计算公式。',
    schema: z.object({ metricId: id, enabled: z.boolean() }).strict(),
  },
] as const;
export const BUSINESS_QUERIES = [
  {
    key: 'get_benefit_policy',
    label: '查询实时会员权益规则',
    permissions: ['member:view'],
    schema: z.object({}).strict(),
  },
  {
    key: 'list_metric_definitions',
    label: '查询指标定义及启停状态',
    permissions: ['metric:view'],
    schema: z.object({}).strict(),
  },
  {
    key: 'list_import_tasks',
    label: '查询导入任务与校验结果',
    permissions: ['data-import:view'],
    schema: z
      .object({
        page: z.number().int().min(1).max(100).default(1),
        importId: id.optional(),
        status: z.enum(['PREVIEW', 'READY', 'IMPORTED', 'FAILED']).optional(),
      })
      .strict(),
  },
] as const;
const hash = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item: unknown) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
          : item,
      ),
    )
    .digest('hex');
type Row = Record<string, unknown>;
export class BusinessOperations {
  constructor(private readonly config: ConfigService) {}
  definition(kind: string) {
    return BUSINESS_OPERATIONS.find((d) => d.kind === kind);
  }
  private policy(user: AuthUser, permissions: readonly string[]) {
    if (
      !permissions.every((p) => user.permissions.includes(p)) ||
      !user.roles.some((r) => r.dataScope === 'ALL')
    )
      throw new ForbiddenException('需要对应业务权限与ALL数据范围');
  }
  async request(credential: string, path: string, method = 'GET', body?: unknown) {
    if (!credential) throw new ForbiddenException('缺少当前登录凭据');
    const response = await fetch(
      `http://127.0.0.1:${this.config.get('PORT', 3200)}/api/v1/${path}`,
      {
        method,
        headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      },
    );
    const result = (await response.json()) as { data: unknown; message?: string };
    if (!response.ok) {
      if ([401, 403].includes(response.status))
        throw new ForbiddenException('当前账号无权执行该业务');
      if (response.status < 500) throw new BadRequestException(result.message || '业务条件不满足');
      throw new Error('业务服务暂不可用');
    }
    return result.data;
  }
  private importSummary(r: Row) {
    return {
      id: r.id,
      fileName: r.fileName,
      status: r.status,
      totalRows: r.totalRows,
      successRows: r.successRows,
      failedRows: r.failedRows,
      errors: (r.errors as Row[] | undefined)
        ?.slice(0, 20)
        .map((e) => ({ rowNo: e.rowNo, field: e.field, message: e.message })),
    };
  }
  async query(user: AuthUser, credential: string, key: string, input: unknown) {
    const d = BUSINESS_QUERIES.find((d) => d.key === key);
    if (!d) throw new BadRequestException('不支持的查询');
    this.policy(user, d.permissions);
    const args = d.schema.parse(input) as { importId?: string; page?: number; status?: string };
    if (key === 'get_benefit_policy')
      return {
        ok: true,
        policy: await this.request(credential, 'member-benefits/policy'),
        definition: '实时权益配置；discountBps为万分比，积分只通过原交易规则累计和冲回。',
      };
    if (key === 'list_metric_definitions')
      return { ok: true, items: await this.request(credential, 'metrics/definitions') };
    if (args.importId) {
      const r = (await this.request(
        credential,
        'data-imports/' + encodeURIComponent(args.importId),
      )) as Row | null;
      if (!r) throw new NotFoundException('导入任务不存在');
      return { ok: true, task: this.importSummary(r) };
    }
    const r = (await this.request(
      credential,
      'data-imports?pageSize=10&page=' + args.page + (args.status ? '&status=' + args.status : ''),
    )) as {
      items: Row[];
      total: number;
    };
    return {
      ok: true,
      total: r.total,
      page: args.page,
      pageSize: 10,
      items: r.items.map((r) => this.importSummary(r)),
      definition: 'CSV通过聊天附件或原导入页上传；READY仅表示校验通过，尚未写入订单。',
    };
  }
  async preview(user: AuthUser, credential: string, kind: string, input: unknown) {
    const d = this.definition(kind);
    if (!d) throw new BadRequestException('不支持的业务操作');
    this.policy(user, d.permissions);
    const args = d.schema.parse(input) as Row;
    let before: unknown,
      body: unknown,
      path: string,
      summary: Row,
      fields: { label: string; before: unknown; after: unknown }[];
    if (kind === 'BENEFIT_POLICY') {
      const p = (await this.request(credential, 'member-benefits/policy')) as {
        enabled: boolean;
        version: number;
        tiers: MemberTierRule[];
      };
      const changes = (args.changes || []) as Partial<MemberTierRule>[];
      if (new Set(changes.map((c) => c.code)).size !== changes.length)
        throw new BadRequestException('同一等级不能重复修改');
      const tiers = validateTierRules(
        p.tiers.map((t) => ({ ...t, ...changes.find((c) => c.code === t.code) })),
      );
      body = { enabled: args.enabled ?? p.enabled, tiers, version: p.version, reason: args.reason };
      before = { version: p.version };
      path = 'member-benefits/policy';
      summary = { name: '全平台会员权益（影响后续报价，历史订单保留快照）' };
      fields = [{ label: '会员折扣启用', before: p.enabled, after: (body as Row).enabled }];
      for (const t of tiers) {
        const old = p.tiers.find((r) => r.code === t.code)!;
        for (const k of ['name', 'minimumSpend', 'discountBps', 'pointsPerYuan'] as const)
          if (String(old[k]) !== String(t[k]))
            fields.push({
              label: `${old.name}·${{ name: '等级名称', minimumSpend: '升级门槛', discountBps: '折扣万分比', pointsPerYuan: '每元积分' }[k]}`,
              before: old[k],
              after: t[k],
            });
      }
      if (fields.length === 1 && p.enabled === (body as Row).enabled)
        throw new BadRequestException('规则相同，无需修改');
    } else if (kind === 'MEMBER_TIER') {
      const r = (await this.request(
        credential,
        'member-benefits/members/' + encodeURIComponent(String(args.memberId)),
      )) as { member: Row };
      before = { updatedAt: r.member.updatedAt, tierOverride: r.member.tierOverride };
      if (r.member.tierOverride === args.tierOverride)
        throw new BadRequestException('等级设置相同，无需修改');
      path = 'member-benefits/members/' + encodeURIComponent(String(args.memberId)) + '/tier';
      body = { tierOverride: args.tierOverride, reason: args.reason };
      summary = { name: r.member.name };
      fields = [
        {
          label: '手动等级（不改变积分/累计消费）',
          before: r.member.tierOverride ?? '自动等级',
          after: args.tierOverride ?? '恢复自动等级',
        },
      ];
    } else if (kind === 'IMPORT_CONFIRM') {
      const r = (await this.request(
        credential,
        'data-imports/' + encodeURIComponent(String(args.importId)),
      )) as Row | null;
      if (!r || r.status !== 'READY')
        throw new BadRequestException('只有校验全部通过的READY任务才能导入');
      before = { fingerprint: hash(r) };
      path = 'data-imports/' + encodeURIComponent(String(args.importId)) + '/confirm';
      body = {};
      summary = { name: r.fileName };
      fields = [
        { label: '导入行数（将写入历史订单）', before: 0, after: r.successRows },
        { label: '导入任务编号', before: r.id, after: r.id },
      ];
    } else {
      const rows = (await this.request(credential, 'metrics/definitions')) as Row[];
      const r = rows.find((r) => r.id === args.metricId);
      if (!r) throw new NotFoundException('指标不存在');
      if (r.enabled === args.enabled) throw new BadRequestException('指标状态相同，无需修改');
      before = { enabled: r.enabled };
      path = 'metrics/definitions/' + encodeURIComponent(String(args.metricId)) + '/status';
      body = { enabled: args.enabled };
      summary = { name: r.name };
      fields = [{ label: '指标展示开关', before: r.enabled, after: args.enabled }];
    }
    if (args.reason) fields.push({ label: '调整原因', before: '—', after: args.reason });
    return {
      input: args,
      before,
      summary,
      fields,
      execution: { path, body },
      executionHash: hash({ path, body }),
      definition: '仅预览；确认后经原业务接口执行，结果未知不自动重发。',
    };
  }
  async execute(user: AuthUser, credential: string, kind: string, payload: Row) {
    const args = payload.input as Row;
    const fresh = await this.preview(user, credential, kind, args);
    if (
      hash(fresh.before) !== hash(payload.before) ||
      fresh.executionHash !== payload.executionHash
    )
      throw new ConflictException('业务资料已变化，请重新预览');
    // 执行地址和请求体来自重新校验后的固定分支，不使用模型或持久化草稿中的任意URL。
    const r = (await this.request(
      credential,
      fresh.execution.path,
      kind === 'IMPORT_CONFIRM' ? 'POST' : 'PATCH',
      fresh.execution.body,
    )) as Row;
    return {
      id:
        [r.id, args.memberId, args.metricId, args.importId].find(
          (v): v is string => typeof v === 'string',
        ) ?? 'default',
      name: fresh.summary.name,
      status: kind === 'IMPORT_CONFIRM' ? r.status : 'SAVED',
      ...(r.version ? { version: r.version } : {}),
    };
  }
}
