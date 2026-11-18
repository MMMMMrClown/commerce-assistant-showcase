import { createAgent } from 'langchain';
import { runRetailQuery } from './query-agent';
import type { AuthUser } from '../common/api';
jest.mock('langchain', () => ({
  createAgent: jest.fn(),
  tool: (fn: unknown, meta: { name: string }) => ({ name: meta.name, invoke: fn }),
}));
jest.mock('@langchain/openai', () => ({ ChatOpenAI: jest.fn() }));
it('自然语言执行器接入批量工具并传入可信活动上下文，模型无建单工具', async () => {
  const prepareBatchOrders = jest.fn().mockResolvedValue({
    ok: true,
    action: { id: 'batch', kind: 'BATCH_CREATE_ORDERS', status: 'WAITING_CONFIRMATION' },
  });
  const user = {
    id: 'operator',
    permissions: ['dashboard:view', 'order:create', 'member:view', 'product:view', 'store:view'],
    roles: [{ dataScope: 'ALL' }],
  } as AuthUser;
  const state = { lastActivityId: 'published-activity' };
  const args = {
    selection: 'RANDOM_EXISTING',
    memberCount: 15,
    storeId: 'store',
    quantityPerMember: 1,
    benefitMode: 'SECKILL',
  };
  jest.mocked(createAgent).mockImplementation(((config: {
    systemPrompt: string;
    tools: { name: string; invoke: (a: unknown) => Promise<unknown> }[];
  }) => ({
    stream: async function* () {
      expect(config.systemPrompt).toContain('不逐个索取姓名手机号');
      expect(config.tools.some((t) => t.name === 'create_order')).toBe(false);
      await config.tools.find((t) => t.name === 'prepare_batch_orders')!.invoke(args);
      yield [
        { content: '请核对固定名单并点击确认。' },
        { langgraph_node: 'model', langgraph_step: 1 },
      ];
    },
  })) as never);
  const result = await runRetailQuery({
    apiKey: 'synthetic',
    model: 'mock',
    user,
    state,
    message: '从已有会员随机选15位，在合成门店购买刚才秒杀商品，每人1件',
    days: 30,
    history: [],
    members: {} as never,
    knowledge: {} as never,
    actions: { prepareBatchOrders } as never,
    execution: { conversationId: 'conversation', runId: 'run', credential: 'synthetic' },
    freshUser: () => Promise.resolve(user),
    summary: () => Promise.resolve({}),
    audit: () => Promise.resolve(),
  });
  expect(prepareBatchOrders).toHaveBeenCalledWith(
    user,
    expect.objectContaining({ entities: state }),
    args,
    state,
  );
  expect(result.state.lastActionId).toBe('batch');
});
