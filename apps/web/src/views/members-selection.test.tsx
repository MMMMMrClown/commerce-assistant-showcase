import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MembersView from './members';
import { ToastProvider } from '../components/ui';

vi.mock('@/store/store', () => ({ useAppSelector: () => true }));
vi.mock('@/components/members/benefit-policy', () => ({ BenefitPolicyCard: () => null }));
vi.mock('@/hooks/use-api', () => ({
  useApi: (url: string) => {
    const page = Number(new URLSearchParams(url.split('?')[1]).get('page')) || 1;
    const items = (page === 1 ? Array.from({ length: 20 }, (_, i) => i + 1) : [21]).map((i) => ({
      id: 'm' + i,
      name: '会员' + i,
      phone: '100' + i,
      enabled: i !== 20,
      totalSpent: '0.00',
      points: 0,
      tier: 'STANDARD',
      tierName: '晴芽',
      tierSource: 'AUTO',
      discountBps: 10000,
    }));
    return {
      data: url.startsWith('/members?') ? { items, total: 21 } : [],
      loading: false,
      error: '',
      reload: vi.fn(),
    };
  },
}));
afterEach(cleanup);
const start = () =>
  render(
    <ToastProvider>
      <MembersView />
    </ToastProvider>,
  );

describe('会员批量选择', () => {
  it('支持跨页勾选，当前页全选排除停用会员', () => {
    start();
    fireEvent.click(screen.getByLabelText('选择会员会员1'));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    fireEvent.click(screen.getByLabelText('选择会员会员21'));
    expect(screen.getByText('已选择 2 位会员（可跨页勾选）')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(screen.getByLabelText('选择会员会员1')).toBeChecked();
    fireEvent.click(screen.getByLabelText('全选当前页会员'));
    expect(screen.getByText('已选择 20 位会员（可跨页勾选）')).toBeInTheDocument();
    expect(screen.getByLabelText('选择会员会员20')).toBeDisabled();
  });

  it('全量选择跨页生效，改搜索条件会清空选择', () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: '选择全部符合条件的会员' }));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByLabelText('选择会员会员21')).toBeChecked();
    expect(screen.getByText('已选择全部符合条件的启用会员（跨页）')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索会员'), { target: { value: '甲' } });
    expect(screen.getByText('已选择 0 位会员（可跨页勾选）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批量发券' })).toBeDisabled();
  });
});
