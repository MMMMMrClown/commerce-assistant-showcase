import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import AgentView from './agent';
const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: transport }));
vi.mock('@/hooks/use-api', () => ({
  useApi: (url: string) => ({
    data:
      url === '/agent/capabilities' ? [{ key: 'query_sales_summary' }] : { traceEnabled: false },
    loading: false,
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it('正常快捷查询沿用原会话和流式接口，并展示真实响应内容', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  transport.get.mockResolvedValue({ data: { data: [] } });
  transport.post.mockResolvedValue({ data: { data: { id: 'quick-session' } } });
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(
        'event: done\ndata: {"answer":"本次查询营业额为200元","mode":"direct","requestId":"r","evidence":[]}\n\n',
        { status: 200 },
      ),
    );
  render(<AgentView compact />);
  fireEvent.click(screen.getByRole('button', { name: '直接查询 · 销售概览' }));
  expect(await screen.findByText('本次查询营业额为200元')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/agent/chat/stream');
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
    conversationId: 'quick-session',
    tool: 'query_sales_summary',
  });
});
it('快捷小窗在创建会话期间关闭，不会在后台继续发起聊天或模型请求', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  transport.get.mockResolvedValue({ data: { data: [] } });
  let finish!: (value: unknown) => void;
  transport.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const fetch = vi.spyOn(globalThis, 'fetch');
  const view = render(<AgentView compact />);
  fireEvent.click(screen.getByRole('button', { name: '直接查询 · 销售概览' }));
  expect(transport.post).toHaveBeenCalledWith('/agent/conversations');
  view.unmount();
  await act(async () => {
    finish({ data: { data: { id: 'closed-session' } } });
    await Promise.resolve();
  });
  expect(fetch).not.toHaveBeenCalled();
});
