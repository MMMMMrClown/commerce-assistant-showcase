import { availableCapabilities } from './capability-registry';
import type { AuthUser } from '../common/api';
// 【能力说明】不依赖模型，不把问好/使用帮助误当成必须查数据库的业务事实。
export function conversationGuide(message: string, user: AuthUser, writesEnabled: boolean) {
  const greeting = /^(你好|您好|嗨|哈喽|hello|hi|早上好|晚上好)[！!。,.，\s]*$/i.test(
    message.trim(),
  );
  const help =
    /你.*(?:是谁|叫什么|做什么|干什么|哪些功能|什么功能|能力|帮.*什么)|(?:怎么使用|使用帮助|可写.*操作)/.test(
      message,
    );
  if (!greeting && !help) return;
  if (greeting)
    return '你好，我是拾光，专门协助你管理这个零售平台。你可以直接告诉我要处理的业务，或者问我“你能做什么”查看当前账号可用能力。';
  const capabilities = availableCapabilities(user, writesEnabled);
  const operations = capabilities
    .filter((c) => c.requiresApproval)
    .map((c) => c.label + '：' + c.description);
  const queries = capabilities
    .filter((c) => !c.requiresApproval && c.key !== 'get_capabilities')
    .map((c) => c.label);
  return `${greeting ? '你好，我是拾光，你的零售运营助手。' : '我是拾光，专门协助你管理这个零售平台。'}

当前账号可用查询：${queries.length ? queries.join('、') : '暂无授权查询能力'}。

${operations.length ? '当前账号可以准备以下操作：\n\n' + operations.map((s) => '- ' + s).join('\n') : '当前账号没有可用的写操作权限，可以使用已授权的查询功能。'}

${writesEnabled ? '这些操作都先展示确认卡，只有你点击确认才会执行。' : '当前写开关关闭，可查询和预览，不能确认执行。'}
商品与会员的可修改项以上述当前账号能力为准。库存和模拟履约可按已授权工具预览确认处理；助手不直接修改积分或累计消费，不执行真实支付退款。

${capabilities.some((c) => c.key === 'prepare_seckill_activity') ? '你可以说“帮我准备一个秒杀活动”，我会先询问缺少的信息。' : '你可以从上述已授权的能力开始提问。'}`;
}
