import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTrace } from './agent-trace';
const fixture = vi.hoisted(() => ({
  error: '',
  reload: vi.fn(),
  data: {
    events: [
      {
        id: 'event1',
        at: '2026-11-13T02:00:00Z',
        title: '模型请求业务数据',
        detail: '准备读取销售统计，再生成建议草稿。',
        technologies: ['LangChain JS', 'Zod'],
        status: 'SUCCEEDED',
      },
    ],
    status: 'SUCCEEDED',
    trace: [
      {
        sequence: 1,
        toolName: 'search_members',
        status: 'SUCCEEDED',
        durationMs: 17,
        argumentFields: ['keyword'],
        sources: [{ section: '会员规则', ruleVersion: 'fixture-v1', sourcePath: 'rules.ts' }],
      },
    ],
    actions: [],
    mcp: { connected: false, note: '当前未接入MCP' },
  },
}));
vi.mock('@/hooks/use-api', () => ({ useApi: () => fixture }));
afterEach(() => {
  cleanup();
  fixture.error = '';
});
describe('管理员执行面板新增展示', () => {
  it('执行中默认收起，点击才展开；状态更新不改变管理员选择', () => {
    const { container, rerender } = render(<AgentTrace runId="fixture" live />);
    const details = container.querySelector('details')!;
    const summary = details.querySelector('summary')!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText('模型请求业务数据')).toBeInTheDocument();
    rerender(<AgentTrace runId="fixture" live={false} />);
    expect(details.open).toBe(true);
    fireEvent.click(summary);
    expect(details.open).toBe(false);
    rerender(<AgentTrace runId="fixture" live />);
    expect(details.open).toBe(false);
  });
  it('展示顺序、耗时、字段名和来源，不生成MCP调用', () => {
    render(<AgentTrace runId="fixture" live={false} />);
    expect(screen.getByText('17 ms')).toBeInTheDocument();
    expect(screen.getByText(/输入字段：keyword/)).toBeInTheDocument();
    expect(screen.getByText(/规则来源：会员规则/)).toBeInTheDocument();
    expect(screen.getByText('当前未接入MCP')).toBeInTheDocument();
    expect(screen.getByText('模型请求业务数据')).toBeInTheDocument();
    expect(screen.getByText('准备读取销售统计，再生成建议草稿。')).toBeInTheDocument();
    expect(screen.getByText('LangChain JS · Zod')).toBeInTheDocument();
  });
  it('权限读取失败时隐藏已缓存的执行明细', () => {
    fixture.error = '403';
    render(<AgentTrace runId="fixture" live={false} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('17 ms')).not.toBeInTheDocument();
    expect(screen.queryByText('模型请求业务数据')).not.toBeInTheDocument();
  });
});
