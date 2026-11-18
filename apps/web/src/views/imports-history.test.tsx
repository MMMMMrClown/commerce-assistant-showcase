import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ImportHistoryPage } from './imports';
const { urls } = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock('@/hooks/use-api', () => ({
  useApi: (url: string) => {
    urls.push(url);
    const params = new URLSearchParams(url.split('?')[1]);
    const status = params.get('status');
    return {
      data: {
        items: [
          {
            id: 't',
            fileName: '第二页待确认.csv',
            createdBy: { name: '测试' },
            createdAt: '2026-11-16',
            totalRows: 1,
            successRows: 1,
            failedRows: 0,
            status: status || 'READY',
          },
        ],
        total: status ? 41 : 161,
        statusCounts: { '': 161, READY: 41, IMPORTED: 120 },
      },
      loading: false,
      error: null,
    };
  },
}));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() }, errorMessage: () => '错误' }));
describe('导入历史分页', () => {
  it('状态条件随翻页提交后端，不在当前页自行过滤', () => {
    render(<ImportHistoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /待确认/ }));
    expect(urls.at(-1)).toContain('status=READY');
    expect(urls.at(-1)).toContain('page=1&');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(urls.at(-1)).toContain('page=2&');
    expect(urls.at(-1)).toContain('status=READY');
    fireEvent.click(screen.getByRole('button', { name: /已导入/ }));
    expect(urls.at(-1)).toContain('page=1&');
    expect(urls.at(-1)).toContain('status=IMPORTED');
  });
});
