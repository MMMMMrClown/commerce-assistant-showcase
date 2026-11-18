import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
export type ExecutionEvent = {
  id: string;
  at: string;
  title: string;
  detail: string;
  technologies: string[];
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'WAITING';
  toolName?: string;
};
export async function recordExecution(
  db: PrismaService,
  runId: string,
  event: Omit<ExecutionEvent, 'id' | 'at'>,
) {
  const item: ExecutionEvent = { ...event, id: randomUUID(), at: new Date().toISOString() };
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "id" = ${runId} FOR UPDATE`;
    const row = await tx.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const state = row.state as { events?: ExecutionEvent[] };
    await tx.agentRun.update({
      where: { id: runId },
      data: {
        state: JSON.parse(
          JSON.stringify({ ...state, events: [...(state.events || []), item].slice(-100) }),
        ) as Prisma.InputJsonValue,
      },
    });
  });
  return item;
}
export function toolTechnologies(name: string) {
  if (name === 'query_product_sales')
    return ['LangChain Tool Calling', 'Zod', 'Prisma / PostgreSQL · 商品全量聚合'];
  if (name === 'compare_business_periods')
    return ['LangChain Tool Calling', 'Zod', '原统计 Service · 同口径比较', 'Prisma / PostgreSQL'];
  if (name === 'search_business_knowledge')
    return ['LangChain RAG', '百炼 · Qwen3.7 Embedding Flash', 'pgvector'];
  if (name.includes('plan')) return ['LangChain Tool Calling', 'Zod', 'PostgreSQL · 会话计划'];
  if (name.startsWith('prepare_') || name.startsWith('propose_') || name === 'quote_order')
    return ['LangChain Tool Calling', 'Zod', 'NestJS · 草稿/报价校验', 'Prisma / PostgreSQL'];
  const service =
    name.includes('sales') || name.includes('period')
      ? 'MetricsService'
      : name.includes('payment') || name.includes('refund')
        ? 'PaymentsService'
        : name.includes('seckill')
          ? 'SeckillService'
          : name.includes('member')
            ? 'MembersService / MemberBenefitsService'
            : name.includes('product')
              ? 'ProductsService'
              : name.includes('order') || name.includes('campaign')
                ? 'OrdersService'
                : '业务 Service';
  return ['LangChain Tool Calling', 'Zod', `NestJS · ${service}`, 'Prisma / PostgreSQL'];
}
