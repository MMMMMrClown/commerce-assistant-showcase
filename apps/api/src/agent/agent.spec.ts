import { runRetailQuery } from './query-agent';
jest.mock('./query-agent', () => ({ runRetailQuery: jest.fn() }));
jest.mock('./knowledge/knowledge.service', () => ({ KnowledgeService: class {} }));
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest mock call assertions use controlled test fixtures. */
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService } from './agent.module';
import type { AuthUser } from '../common/api';

describe('运营Agent权限、工具协议与故障处理', () => {
  const user: AuthUser = {
    id: 'operator',
    username: 'operator',
    name: '运营',
    regionId: null,
    storeId: null,
    roles: [{ code: 'ADMIN', name: '管理者', dataScope: 'ALL' }],
    permissions: ['dashboard:view', 'member:view', 'order:view', 'seckill:view'],
  };
  let agent: AgentService;
  const metrics = { overview: jest.fn(), charts: jest.fn() };
  const members = { statistics: jest.fn() };
  const orders = { campaignPerformance: jest.fn() };
  const payments = { statistics: jest.fn() };
  const log = jest.fn().mockResolvedValue({});
  const settings: Record<string, string> = {};
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(settings)) delete settings[key];
    metrics.overview.mockResolvedValue({ revenue: 123, orderCount: 3 });
    metrics.charts.mockResolvedValue({ productRanking: [{ name: '保温杯', value: 2 }] });
    agent = new AgentService(
      { get: (key: string) => settings[key] } as ConfigService,
      metrics as never,
      members as never,
      orders as never,
      payments as never,
      { operationLog: { create: log } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('直接模式调用业务Service并落审计，返回来源凭据', async () => {
    const reply = await agent.chat(user, { message: '销售', tool: 'query_sales_summary', days: 7 });
    expect(reply.mode).toBe('direct');
    expect(reply.evidence[0].result).toMatchObject({ revenue: 123 });
    expect(metrics.overview).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ startDate: expect.any(String) }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: user.id, success: true }),
      }),
    );
  });
  it.each([0, 91, 2.5, '7'])('拒绝非法时间参数 %s', async (days) => {
    await expect(
      agent.execute(user, 'query_sales_summary', { days }, 'test'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(metrics.overview).not.toHaveBeenCalled();
  });
  it('拒绝未知工具与额外SQL参数', async () => {
    await expect(agent.execute(user, 'execute_sql', {}, 't')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      agent.execute(user, 'query_sales_summary', { days: 7, sql: 'select' }, 't'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('缺少业务权限不能借模型越权', async () => {
    await expect(
      agent.execute({ ...user, permissions: ['dashboard:view'] }, 'query_payment_summary', {}, 't'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(payments.statistics).not.toHaveBeenCalled();
  });
  it('门店管理者不能查询全平台会员数据', async () => {
    await expect(
      agent.execute(
        { ...user, roles: [{ code: 'STORE', name: '店长', dataScope: 'STORE' }] },
        'query_member_statistics',
        {},
        't',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('未配置模型不会伪装生成回答', async () => {
    await expect(agent.chat(user, { message: '分析', days: 30 })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('应用层转发LangChain结果与结构化会话状态', async () => {
    settings.AGENT_API_KEY = 'test';
    settings.AGENT_MODEL = 'test';
    jest
      .mocked(runRetailQuery)
      .mockResolvedValueOnce({ answer: '请提供会员姓名或完整手机号', evidence: [], state: {} });
    const result = await agent.chat(user, { message: '查会员', days: 30 });
    expect(result.answer).toContain('手机号');
    expect(result.mode).toBe('model');
  });
  it('业务查询失败写入失败审计', async () => {
    metrics.overview.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(agent.execute(user, 'query_sales_summary', { days: 7 }, 't')).rejects.toThrow();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ success: false }) }),
    );
  });
});
