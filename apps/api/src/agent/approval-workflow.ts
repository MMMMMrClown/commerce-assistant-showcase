import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Annotation, Command, END, START, StateGraph, interrupt } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { AuthUser } from '../common/api';
import { AgentActions, confirmSchema } from './actions';

const State = Annotation.Root({
  actionId: Annotation<string>(),
  actorId: Annotation<string>(),
  payloadHash: Annotation<string>(),
  phase: Annotation<string>(),
  decision: Annotation<{
    decision: 'APPROVE' | 'REJECT';
    expectedHash: string;
    expectedVersion: number;
  }>(),
  resultStatus: Annotation<string>(),
});

@Injectable()
export class ApprovalWorkflow implements OnModuleDestroy {
  private saver?: Promise<PostgresSaver>;
  constructor(
    private readonly config: ConfigService,
    private readonly actions: AgentActions,
  ) {}
  private open() {
    if (!this.saver)
      this.saver = (async () => {
        const saver = PostgresSaver.fromConnString(this.config.getOrThrow<string>('DATABASE_URL'), {
          schema: 'agent_workflow',
        });
        try {
          await saver.setup();
          return saver;
        } catch (error) {
          await saver.end();
          throw error;
        }
      })().catch((error) => {
        this.saver = undefined;
        throw error;
      });
    return this.saver;
  }
  private async graph(user: AuthUser, credential = '') {
    // 【可信运行上下文】当前请求身份/凭据只捕获在闭包，不进入checkpoint或模型。
    return new StateGraph(State)
      .addNode('human_review', (state) => {
        const decision = confirmSchema.parse(
          interrupt({
            actionId: state.actionId,
            payloadHash: state.payloadHash,
            requiresApproval: true,
          }),
        );
        return { decision, phase: 'DECIDED' };
      })
      .addNode('execute', async (state) => {
        if (state.actorId !== user.id) throw new ConflictException('工作流不属于当前账号');
        const result = await this.actions.confirm(user, state.actionId, state.decision, credential);
        return { phase: 'RESULT_RECORDED', resultStatus: result.status };
      })
      .addEdge(START, 'human_review')
      .addEdge('human_review', 'execute')
      .addEdge('execute', END)
      .compile({ checkpointer: await this.open() });
  }
  // 【等待确认】interrupt节点没有业务副作用；独立schema保存检查点，不更改业务表。
  async prepare(user: AuthUser, id: string) {
    const action = await this.actions.detail(user, id);
    const graph = await this.graph(user);
    const config = { configurable: { thread_id: `${user.id}:${action.id}` } };
    const state = await graph.getState(config);
    if (!(state.values as typeof State.State).actionId)
      await graph.invoke(
        {
          actionId: id,
          actorId: user.id,
          payloadHash: action.payloadHash,
          phase: 'WAITING_CONFIRMATION',
        },
        config,
      );
  }
  async decide(user: AuthUser, id: string, input: unknown, credential: string) {
    const parsed = confirmSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('确认参数格式错误');
    const action = await this.actions.detail(user, id);
    if (parsed.data.expectedHash !== action.payloadHash)
      throw new ConflictException('确认内容已变化');
    if (
      ['SUCCEEDED', 'REJECTED', 'FAILED', 'EXPIRED', 'UNKNOWN', 'EXECUTING'].includes(action.status)
    )
      return this.actions.confirm(user, id, parsed.data, credential);
    await this.prepare(user, id);
    const graph = await this.graph(user, credential);
    const config = { configurable: { thread_id: `${user.id}:${id}` } };
    const state = await graph.getState(config);
    if (state.next.includes('human_review'))
      await graph.invoke(new Command({ resume: parsed.data }), config);
    else if (state.next.includes('execute')) {
      if (
        JSON.stringify((state.values as typeof State.State).decision) !==
        JSON.stringify(parsed.data)
      )
        throw new ConflictException('工作流已记录其他决定，请核对状态');
      await graph.invoke(null, config);
    } else return this.actions.confirm(user, id, parsed.data, credential);
    return this.actions.detail(user, id);
  }
  async onModuleDestroy() {
    if (this.saver) await (await this.saver.catch(() => undefined))?.end();
  }
  async progress(user: AuthUser, id: string) {
    await this.actions.detail(user, id);
    const graph = await this.graph(user);
    const snapshot = await graph.getState({ configurable: { thread_id: `${user.id}:${id}` } });
    return {
      phase: (snapshot.values as typeof State.State).phase || 'NO_CHECKPOINT',
      nextNodes: snapshot.next,
    };
  }
}
