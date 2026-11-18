import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskPlan } from './agent-task-plan';
const fixture = vi.hoisted(() => ({
  data: {
    id: 'plan1',
    title: '创建券并发放',
    status: 'PARTIAL_COMPLETED',
    missingFields: [] as string[],
    steps: [
      { key: 'template', title: '创建满减券模板', status: 'SUCCEEDED', resourceId: 'template1' },
      { key: 'issue', title: '向指定会员发券', status: 'PENDING' },
    ],
  },
  error: '',
  reload: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/hooks/use-api', () => ({ useApi: () => fixture }));
vi.mock('@/lib/api', () => ({ api: { post: fixture.post }, errorMessage: () => '处理失败' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fixture.data.missingFields = [];
  fixture.error = '';
});
const props = () => ({
  conversationId: 'c1',
  refreshKey: 0,
  disabled: false,
  onAction: vi.fn(),
  onChanged: vi.fn(),
  onPrompt: vi.fn(),
});
describe('连续营销任务面板', () => {
  it('跨业务任务续接只填写下一步需求，不直接批准', async () => {
    fixture.post.mockResolvedValue({ data: { data: { nextPrompt: '继续创建订单' } } });
    const p = props();
    render(<AgentTaskPlan {...p} resource="operation-plan" />);
    fireEvent.click(screen.getByRole('button', { name: '继续下一步' }));
    await waitFor(() => expect(p.onPrompt).toHaveBeenCalledWith('继续创建订单'));
    expect(fixture.post).toHaveBeenCalledExactlyOnceWith(
      '/agent/conversations/c1/operation-plan/resume',
    );
  });
  it('保留已完成结果，续接仅准备操作，不调用批准接口', async () => {
    const p = props();
    fixture.post.mockResolvedValue({ data: { data: { action: { id: 'a2' } } } });
    render(<AgentTaskPlan {...p} />);
    expect(screen.getByText('模板编号：template1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '准备下一步' }));
    await waitFor(() => expect(p.onAction).toHaveBeenCalledWith({ id: 'a2' }));
    expect(fixture.post).toHaveBeenCalledExactlyOnceWith(
      '/agent/conversations/c1/task-plan/resume',
    );
    expect(p.onChanged).toHaveBeenCalledOnce();
  });
  it('缺项只填写输入框，不发起业务操作', () => {
    fixture.data.missingFields = ['发券会员'];
    const p = props();
    render(<AgentTaskPlan {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '补充信息' }));
    expect(p.onPrompt).toHaveBeenCalledWith(expect.stringContaining('发券会员'));
    expect(fixture.post).not.toHaveBeenCalled();
  });
  it('停止剩余步骤后刷新旧确认卡，明确不撤销已完成业务', async () => {
    fixture.post.mockResolvedValue({ data: { data: {} } });
    const p = props();
    render(<AgentTaskPlan {...p} />);
    expect(screen.getByText(/停止任务不撤销已完成的业务/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '停止剩余步骤' }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalledOnce());
    expect(fixture.post).toHaveBeenCalledExactlyOnceWith(
      '/agent/conversations/c1/task-plan/cancel',
    );
  });
});
