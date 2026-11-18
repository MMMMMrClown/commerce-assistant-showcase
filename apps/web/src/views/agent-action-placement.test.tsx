import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AgentView from './agent';
vi.mock('@/hooks/use-api', () => ({ useApi: () => ({ data: [], loading: false }) }));
vi.mock('@/components/agent-task-plan', () => ({ AgentTaskPlan: () => null }));
vi.mock('@/components/agent-answer', () => ({
  AgentAnswer: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock('@/components/agent-action', () => ({
  AgentActionCard: () => <div data-testid="rejected-card">已拒绝秒杀</div>,
}));
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      const data =
        path === '/agent/conversations'
          ? [{ id: 'c1', title: '原会话' }]
          : {
              messages: [
                {
                  question: '创建秒杀',
                  reply: { requestId: 'q1', runId: 'r1', answer: '秒杀建议' },
                },
                {
                  question: '新增会员',
                  reply: { requestId: 'q2', runId: 'r2', answer: '请提供手机号' },
                },
              ],
              actions: [{ id: 'a1', runId: 'r1', status: 'REJECTED' }],
            };
      return { data: { data } };
    }),
  },
}));
afterEach(cleanup);
it('旧秒杀卡渲染在原回答下，新回答及新建会话不带旧卡', async () => {
  render(<AgentView />);
  fireEvent.click(await screen.findByRole('button', { name: '原会话' }));
  const oldQuestion = await screen.findByText('创建秒杀');
  const oldTurn = oldQuestion.parentElement!.parentElement!;
  const newTurn = screen.getByText('新增会员').parentElement!.parentElement!;
  expect(within(oldTurn).getByTestId('rejected-card')).toBeInTheDocument();
  expect(within(newTurn).queryByTestId('rejected-card')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  expect(screen.queryByTestId('rejected-card')).not.toBeInTheDocument();
});
