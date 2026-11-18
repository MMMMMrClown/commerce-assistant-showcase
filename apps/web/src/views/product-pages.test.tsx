import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProductPages from './product-pages';
const push = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ search: 'categoryId=office' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('./management', () => ({
  default: ({
    kind,
    initialCategoryId,
    initialState,
    onViewCategory,
  }: {
    kind: string;
    initialCategoryId: string;
    initialState?: string;
    onViewCategory?: (id: string) => void;
  }) => (
    <div data-state={initialState}>
      {kind} {initialCategoryId}
      {onViewCategory && <button onClick={() => onViewCategory('office')}>查看分类商品</button>}
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  state.search = 'categoryId=office';
});
it('工作台库存预警入口打开对应状态，非法状态不传入筛选', () => {
  state.search = 'state=warning';
  const view = render(<ProductPages />);
  expect(view.container.firstChild).toHaveAttribute('data-state', 'warning');
  state.search = 'state=unexpected';
  view.rerender(<ProductPages />);
  expect(view.container.firstChild).toHaveAttribute('data-state', '');
});
it('商品页从地址读取分类筛选', () => {
  render(<ProductPages />);
  expect(screen.getByText('products office')).toBeInTheDocument();
});
it('分类页跳转独立商品地址', () => {
  render(<ProductPages categories />);
  fireEvent.click(screen.getByText('查看分类商品'));
  expect(push).toHaveBeenCalledWith('/products?categoryId=office');
});
