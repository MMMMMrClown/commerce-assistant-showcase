import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AgentEvidence } from './agent-evidence';
afterEach(cleanup);
it('同轮多次查询合并为一个默认折叠区，展示业务表格、时间和口径，不输出JSON', () => {
  const { container } = render(
    <AgentEvidence
      evidence={[
        {
          name: 'list_products',
          queriedAt: '2026-11-13T06:00:00Z',
          scope: '当前门店范围',
          result: {
            ok: true,
            total: 1,
            items: [
              {
                id: 'internal-id',
                name: '便携保温杯',
                price: '99.00',
                enabled: true,
                category: { name: '日用百货' },
              },
            ],
          },
        },
        {
          queriedAt: '2026-11-13T06:01:00Z',
          result: {
            result: {
              period: { startDate: '2026-10-15', endDate: '2026-11-13' },
              revenue: 0,
              orderCount: 0,
              definition: '完成且未退款订单',
            },
          },
        },
        { queriedAt: '2026-11-13T06:02:00Z', result: { action: { id: 'draft1' } } },
      ]}
    />,
  );
  expect(container.querySelectorAll('details')).toHaveLength(1);
  expect(container.querySelector('details')!.open).toBe(false);
  expect(screen.getByText('查看数据依据 · 2项查询')).toBeInTheDocument();
  expect(screen.getByText('便携保温杯')).toBeInTheDocument();
  expect(screen.getByText('日用百货')).toBeInTheDocument();
  expect(screen.getByText(/2026-10-15 至 2026-11-13/)).toBeInTheDocument();
  expect(screen.getAllByText('0')).toHaveLength(2);
  expect(screen.getByText(/完成且未退款订单/)).toBeInTheDocument();
  expect(container.querySelector('pre')).toBeNull();
  expect(screen.queryByText('internal-id')).not.toBeInTheDocument();
});
it('支付聚合转换成金额和笔数，不展示底层_sum和_count结构', () => {
  const { container } = render(
    <AgentEvidence
      evidence={[
        {
          queriedAt: '2026-11-13T06:00:00Z',
          result: {
            payments: [
              {
                status: 'SUCCEEDED',
                channel: 'MOCK',
                _sum: { amount: '125.50' },
                _count: { _all: 3 },
              },
            ],
            refunds: [],
          },
        },
      ]}
    />,
  );
  expect(screen.getByText('125.50')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(container.textContent).not.toContain('_sum');
  expect(container.querySelector('pre')).toBeNull();
});
