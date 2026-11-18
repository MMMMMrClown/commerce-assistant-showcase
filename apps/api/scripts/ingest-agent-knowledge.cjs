// 【白名单摄入】独立规则库维护入口，不读取或写入会员、订单表，也不调用聊天模型。
const { ConfigModule, ConfigService } = require('@nestjs/config');
const { KnowledgeService } = require('../dist/src/agent/knowledge/knowledge.service');
(async () => {
  await ConfigModule.forRoot();
  const service = new KnowledgeService(new ConfigService());
  try {
    const result = await service.ingest();
    console.log(JSON.stringify(result));
  } finally {
    await service.onModuleDestroy();
  }
})().catch(() => {
  console.error('规则摄入失败，请检查独立知识库、百炼向量接口地址、密钥及Flash模型权限。');
  process.exitCode = 1;
});
