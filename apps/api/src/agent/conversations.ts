import type { MemberState } from './member-tools';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { topLevelActionIds } from './batch-operations';
type Turn = {
  question: string;
  reply: {
    answer: string;
    requestId: string;
    mode: string;
    runId?: string;
    evidence?: { result?: { action?: { id: string } } }[];
  };
};
@Injectable()
export class ConversationsService {
  constructor(private readonly db: PrismaService) {}
  list(userId: string) {
    return this.db.agentConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: { id: true, title: true, updatedAt: true },
    });
  }
  create(userId: string) {
    return this.db.agentConversation.create({ data: { userId } });
  }
  async detail(userId: string, id: string) {
    const item = await this.db.agentConversation.findFirst({ where: { id, userId } });
    if (!item) throw new NotFoundException('会话不存在');
    const actions = await this.db.agentAction.findMany({
      where: {
        conversationId: id,
        userId,
        id: { in: await topLevelActionIds(this.db, userId, id) },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const turns = item.messages as unknown as Turn[];
    const ids = turns.flatMap((t) =>
      (t.reply.evidence || []).flatMap((e) => (e.result?.action?.id ? [e.result.action.id] : [])),
    );
    const sourceActions = ids.length
      ? await this.db.agentAction.findMany({
          where: { id: { in: ids }, conversationId: id, userId },
          select: { id: true, runId: true },
        })
      : [];
    const runs = new Map(sourceActions.map((a) => [a.id, a.runId]));
    const messages = turns.map((t) => {
      const runId =
        t.reply.runId ||
        (t.reply.evidence || [])
          .map((e) => e.result?.action?.id && runs.get(e.result.action.id))
          .find(Boolean);
      return runId ? { ...t, reply: { ...t.reply, runId } } : t;
    });
    return { ...item, messages, actions };
  }
  async remove(userId: string, id: string) {
    const result = await this.db.agentConversation.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException('会话不存在');
    return { deleted: true };
  }
  async save(
    userId: string,
    id: string,
    version: number,
    question: string,
    reply: Omit<Turn['reply'], 'evidence'> & { evidence?: unknown[] },
    state: MemberState = {},
    leaseToken?: string,
  ) {
    const item = await this.detail(userId, id);
    const turns = item.messages;
    const messages = [...turns, { question, reply }];
    if (messages.length > 100) throw new ConflictException('本会话已达100轮，请新建会话');
    const result = await this.db.agentConversation.updateMany({
      where: { id, userId, version, ...(leaseToken ? { leaseToken } : {}) },
      data: {
        title: turns.length ? item.title : question.slice(0, 30),
        state: JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue,
        messages: JSON.parse(JSON.stringify(messages)) as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new ConflictException('会话已在其他窗口修改或删除，请重新打开');
  }
}
