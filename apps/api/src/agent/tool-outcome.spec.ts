import { createAgent } from 'langchain';
import { runRetailQuery } from './query-agent';
import type { AuthUser } from '../common/api';
jest.mock('langchain', () => ({
  createAgent: jest.fn(),
  tool: (fn: unknown, meta: { name: string }) => ({ name: meta.name, invoke: fn }),
}));
jest.mock('@langchain/openai', () => ({ ChatOpenAI: jest.fn() }));

it('返回失败对象的工具在进度、trace和审计中统一标为失败', async () => {
  jest.mocked(createAgent).mockImplementation(((config: {
    tools: { name: string; invoke: (args: unknown) => Promise<unknown> }[];
  }) => ({
    stream: async function* () {
      await config.tools
        .find((t) => t.name === 'search_business_knowledge')!
        .invoke({ question: '库存规则' });
      yield [
        { content: '规则库暂不可用，请稍后重试' },
        { langgraph_node: 'model', langgraph_step: 1 },
      ];
    },
  })) as never);
  const user = { permissions: ['dashboard:view'], roles: [{ dataScope: 'ALL' }] } as AuthUser;
  const audit = jest.fn().mockResolvedValue(undefined),
    emit = jest.fn(),
    progress = jest.fn().mockResolvedValue(undefined);
  await runRetailQuery({
    apiKey: 'synthetic',
    model: 'mock',
    user,
    state: {},
    members: {} as never,
    actions: {} as never,
    knowledge: {
      search: () => Promise.resolve({ ok: false, code: 'KNOWLEDGE_UNAVAILABLE' }),
    } as never,
    message: '库存规则',
    days: 30,
    history: [],
    freshUser: () => Promise.resolve(user),
    summary: () => Promise.resolve({}),
    audit,
    emit,
    progress,
  });
  expect(audit).toHaveBeenCalledWith(
    'search_business_knowledge',
    false,
    expect.anything(),
    expect.objectContaining({ status: 'FAILED' }),
  );
  expect(emit).toHaveBeenCalledWith('tool_trace', expect.objectContaining({ status: 'FAILED' }));
  expect(progress).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'FAILED', toolName: 'search_business_knowledge' }),
  );
});
