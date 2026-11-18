import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/pgvector';
import { Pool } from 'pg';
import { KnowledgeService, KNOWLEDGE_MODEL, KNOWLEDGE_TABLE } from './knowledge.service';
import { RULE_VERSION } from './rules';

jest.mock('@langchain/openai', () => ({ OpenAIEmbeddings: jest.fn() }));
jest.mock('@langchain/pgvector', () => ({ PGVectorStore: { initialize: jest.fn() } }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

function config(key = 'synthetic-key') {
  return new ConfigService({
    KNOWLEDGE_DATABASE_URL: 'postgresql://synthetic/test',
    AGENT_EMBEDDING_API_KEY: key,
    AGENT_EMBEDDING_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
}

beforeEach(() => jest.clearAllMocks());

it('缺少专用向量密钥时受控失败，不借用对话模型密钥或连接旧本地服务', async () => {
  const settings = config('');
  settings.set('AGENT_API_KEY', 'synthetic-chat-key');
  const service = new KnowledgeService(settings);
  expect((await service.search('会员规则')).code).toBe('KNOWLEDGE_UNAVAILABLE');
  expect(OpenAIEmbeddings).not.toHaveBeenCalled();
  expect(Pool).not.toHaveBeenCalled();
  await service.onModuleDestroy();
});

it('新模型独立清单重新摄入，只使用Flash向量表且检索限制模型身份', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const pool = { query, end: jest.fn().mockResolvedValue(undefined) };
  const store = {
    addDocuments: jest.fn().mockResolvedValue([]),
    similaritySearchWithScore: jest.fn().mockResolvedValue([]),
    end: jest.fn().mockResolvedValue(undefined),
  };
  jest.mocked(Pool).mockImplementation(() => pool as unknown as Pool);
  jest.mocked(PGVectorStore).initialize.mockResolvedValue(store as unknown as PGVectorStore);
  const service = new KnowledgeService(config());
  try {
    expect((await service.ingest()).unchanged).toBe(false);
    expect(jest.mocked(PGVectorStore).initialize.mock.calls[0]?.[1]).toMatchObject({
      tableName: KNOWLEDGE_TABLE,
      dimensions: 1024,
    });
    expect(OpenAIEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: KNOWLEDGE_MODEL, dimensions: 1024, maxRetries: 0 }),
    );
    expect(query).toHaveBeenCalledWith('SELECT hash FROM agent_knowledge_manifest WHERE id=$1', [
      `${RULE_VERSION}:${KNOWLEDGE_MODEL}:1024`,
    ]);
    expect(store.addDocuments).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({ embeddingModel: KNOWLEDGE_MODEL }) as unknown,
        }),
      ]),
      expect.anything(),
    );
    expect(JSON.stringify(query.mock.calls)).not.toContain('retail_rules_bge_m3_1024');
    query.mockResolvedValue({ rows: [{ hash: 'published-flash-hash' }] });
    await service.search('会员规则');
    expect(store.similaritySearchWithScore).toHaveBeenCalledWith(
      '会员规则',
      6,
      expect.objectContaining({
        embeddingModel: KNOWLEDGE_MODEL,
        datasetHash: 'published-flash-hash',
      }),
    );
  } finally {
    await service.onModuleDestroy();
  }
});
