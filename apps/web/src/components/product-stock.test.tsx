import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { ProductStock } from './product-stock';
const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { post }, errorMessage: () => '请求失败' }));
vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({ data: { items: [], total: 0 }, loading: false, error: '' }),
}));
afterEach(() => {
  cleanup();
  post.mockReset();
});
const start = () =>
  render(
    <ProductStock
      product={{ id: 'p', name: '商品', stockOnHand: 5, stockReserved: 3, stockVersion: 1 }}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
it('拒绝手工减少到占用量以下', () => {
  start();
  fireEvent.change(screen.getByLabelText('现存总量'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('调整原因'), { target: { value: '盘点' } });
  fireEvent.click(screen.getByText('确认保存'));
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('占用量');
});
it('网络失败后重试保留提交标识及版本', async () => {
  post.mockRejectedValue(Error());
  start();
  fireEvent.change(screen.getByLabelText('调整原因'), { target: { value: '盘点' } });
  fireEvent.click(screen.getByText('确认保存'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('确认保存'));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1]);
  expect(post.mock.calls[0][1].version).toBe(1);
});
