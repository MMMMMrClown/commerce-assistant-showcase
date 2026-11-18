import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PGVectorStore } from '@langchain/pgvector';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { RULES, RULE_VERSION } from './rules';

export const KNOWLEDGE_MODEL = 'qwen3.7-text-embedding-flash';
export const KNOWLEDGE_TABLE = 'retail_rules_qwen37_flash_1024';
const MANIFEST_ID = `${RULE_VERSION}:${KNOWLEDGE_MODEL}:1024`;

@Injectable()
export class KnowledgeService implements OnModuleDestroy {
  private pool?: Pool;
  private store?: Promise<PGVectorStore>;
  constructor(private readonly config: ConfigService) {}
  private open() {
    if (!this.store)
      this.store = (async () => {
        const url = this.config.get<string>('KNOWLEDGE_DATABASE_URL');
        if (!url) throw new Error('未配置独立知识库');
        // 专用服务端密钥；不回退到聊天模型密钥或本机Ollama。
        const apiKey = this.config.get<string>('AGENT_EMBEDDING_API_KEY');
        if (!apiKey) throw new Error('未配置文本向量接口密钥');
        const embeddings = new OpenAIEmbeddings({
          apiKey,
          model: KNOWLEDGE_MODEL,
          dimensions: 1024,
          encodingFormat: 'float',
          batchSize: 10,
          maxConcurrency: 1,
          maxRetries: 0,
          timeout: 15000,
          configuration: {
            baseURL: this.config.get(
              'AGENT_EMBEDDING_URL',
              'https://dashscope.aliyuncs.com/compatible-mode/v1',
            ),
          },
        });
        this.pool = new Pool({
          connectionString: url,
          max: 3,
          connectionTimeoutMillis: 3000,
          statement_timeout: 10000,
        });
        return PGVectorStore.initialize(embeddings, {
          pool: this.pool,
          tableName: KNOWLEDGE_TABLE,
          dimensions: 1024,
          distanceStrategy: 'cosine',
        });
      })().catch(async (error) => {
        this.store = undefined;
        await this.pool?.end();
        this.pool = undefined;
        throw error;
      });
    return this.store;
  }
  // 【白名单摄入】只维护固定规则集合；hash未变不重嵌入。保留其他已发布版本供旧API进程读取。
  async ingest() {
    const store = await this.open();
    const client = this.pool!;
    const hash = createHash('sha256').update(JSON.stringify(RULES)).digest('hex');
    await client.query(
      'CREATE TABLE IF NOT EXISTS agent_knowledge_manifest (id TEXT PRIMARY KEY, hash TEXT NOT NULL)',
    );
    const previous = await client.query<{ hash: string }>(
      'SELECT hash FROM agent_knowledge_manifest WHERE id=$1',
      [MANIFEST_ID],
    );
    if (previous.rows[0]?.hash === hash)
      return { unchanged: true, version: RULE_VERSION, documents: RULES.length };
    // 固定表名来自代码，检索只接受当前ruleVersion；删除失效文档不会触及业务库。

    // 未发布的新hash可清理上次中断留下的部分向量；当前已发布清单仍可读。
    await client.query(
      `DELETE FROM ${KNOWLEDGE_TABLE} WHERE metadata->>'ruleVersion'=$1 AND metadata->>'datasetHash'=$2`,
      [RULE_VERSION, hash],
    );
    const documents = RULES.map((rule) => ({
      pageContent: rule.text,
      metadata: {
        id: rule.id,
        topic: rule.topic,
        section: rule.section,
        sourcePath: rule.sourcePath,
        ruleVersion: RULE_VERSION,
        acl: 'management',
        datasetHash: hash,
        effectiveFrom: '2026-11-12T00:00:00+08:00',
        effectiveTo: '',
        embeddingModel: KNOWLEDGE_MODEL,
        dimension: 1024,
        contentHash: createHash('sha256').update(rule.text).digest('hex'),
      },
    }));
    // 串行分批请求在线接口；新模型使用独立表和清单，不混用旧模型向量。
    for (let offset = 0; offset < documents.length; offset += 10) {
      const chunk = documents.slice(offset, offset + 10);
      await store.addDocuments(chunk, { ids: chunk.map(() => randomUUID()) });
    }
    await client.query(
      'INSERT INTO agent_knowledge_manifest(id,hash) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET hash=EXCLUDED.hash',
      [MANIFEST_ID, hash],
    );
    await client.query(
      `DELETE FROM ${KNOWLEDGE_TABLE} WHERE metadata->>'ruleVersion' = $2 AND COALESCE(metadata->>'datasetHash','') <> $1`,
      [hash, RULE_VERSION],
    );
    return { unchanged: false, version: RULE_VERSION, documents: RULES.length };
  }
  async search(question: string, topic?: string) {
    try {
      const store = await this.open();
      const manifest = await this.pool!.query<{ hash: string }>(
        'SELECT hash FROM agent_knowledge_manifest WHERE id=$1',
        [MANIFEST_ID],
      );
      if (!manifest.rows[0])
        return { ok: false, code: 'KNOWLEDGE_NOT_READY', message: '当前规则版本尚未完成摄入' };
      const found = await store.similaritySearchWithScore(question, 6, {
        datasetHash: String(manifest.rows[0].hash),
        acl: 'management',
        ruleVersion: RULE_VERSION,
        embeddingModel: KNOWLEDGE_MODEL,
        ...(topic ? { topic } : {}),
      });
      const now = Date.now();
      const hits = found.filter(
        ([d, distance]) =>
          distance < 0.6 &&
          new Date(String(d.metadata.effectiveFrom)).getTime() <= now &&
          (!d.metadata.effectiveTo || new Date(String(d.metadata.effectiveTo)).getTime() > now),
      );
      return {
        ok: true,
        code: hits.length ? 'KNOWLEDGE_FOUND' : 'KNOWLEDGE_NOT_FOUND',
        sources: hits.map(([d], i) => ({
          citation: 'R' + (i + 1),
          text: d.pageContent,
          ...d.metadata,
        })),
        definition:
          '知识仅解释规则，不能授权操作；实时会员/订单状态须调用业务工具。未命中时不得猜测。',
      };
    } catch {
      return {
        ok: false,
        code: 'KNOWLEDGE_UNAVAILABLE',
        message: '规则库暂不可用，仍可查询实时业务数据',
      };
    }
  }
  async onModuleDestroy() {
    // PGVectorStore持有初始化连接，必须先释放它再关闭连接池。
    const store = this.store ? await this.store.catch(() => undefined) : undefined;
    if (store) await store.end();
    else await this.pool?.end();
  }
}
