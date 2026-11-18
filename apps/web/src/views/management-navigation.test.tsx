import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ManagementHub from './management-hub';
import { ToastProvider } from '../components/ui';
const requests = vi.hoisted(() => [] as string[]);
vi.mock('@/store/store', () => ({
  useAppSelector: (select: (s: unknown) => unknown) =>
    select({
      auth: {
        user: {
          permissions: [
            'product:view',
            'product:create',
            'product-category:view',
            'product-category:edit',
          ],
        },
      },
    }),
}));
vi.mock('@/hooks/use-api', () => ({
  useApi: (url: string) => {
    requests.push(url);
    const categories = [
      { id: 'office', name: '办公文具', code: 'OFFICE', enabled: true, _count: { products: 20 } },
      { id: 'sport', name: '运动户外', code: 'SPORT', enabled: true, _count: { products: 20 } },
    ];
    const query = new URLSearchParams(url.split('?')[1]);
    return {
      data: url.startsWith('/product-categories')
        ? categories
        : url.startsWith('/products?')
          ? {
              items: [
                {
                  id: 'p1',
                  name: query.get('categoryId') === 'office' ? '笔记本' : '背包',
                  code: 'P1',
                  category: categories[0],
                  price: '20',
                  costPrice: '10',
                  enabled: true,
                },
              ],
              total: 40,
            }
          : [],
      loading: false,
      error: '',
      reload: vi.fn(),
    };
  },
}));
afterEach(() => {
  cleanup();
  requests.length = 0;
});
const start = () =>
  render(
    <ToastProvider>
      <ManagementHub mode="products" />
    </ToastProvider>,
  );
const lastQuery = () =>
  new URLSearchParams(
    requests
      .filter((s) => s.startsWith('/products?'))
      .at(-1)
      ?.split('?')[1],
  );
describe('商品分类导航（仅新增UI路径）', () => {
  it('从分类管理点击分类，进入对应商品列表', () => {
    start();
    fireEvent.click(screen.getByRole('tab', { name: '商品分类' }));
    fireEvent.click(screen.getAllByRole('button', { name: '查看办公文具的商品' })[0]);
    expect(screen.getByRole('tab', { name: '商品管理' })).toHaveAttribute('aria-selected', 'true');
    expect(lastQuery().get('categoryId')).toBe('office');
    expect(screen.getByText('笔记本')).toBeInTheDocument();
  });
  it('翻页后换分类，重置到第一页', () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(lastQuery().get('page')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: '办公文具' }));
    expect(lastQuery().get('page')).toBe('1');
    expect(lastQuery().get('categoryId')).toBe('office');
  });
  it('分类、搜索和上架状态可组合，重置可全部清除', () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: '办公文具' }));
    fireEvent.change(screen.getByLabelText('搜索编码或名称'), { target: { value: '笔' } });
    fireEvent.click(screen.getByRole('button', { name: /销售中/ }));
    expect(lastQuery().get('enabled')).toBe('true');
    expect(lastQuery().get('keyword')).toBe('笔');
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(lastQuery().get('categoryId')).toBe('');
    expect(lastQuery().get('keyword')).toBe('');
    expect(lastQuery().has('enabled')).toBe(false);
  });
});
