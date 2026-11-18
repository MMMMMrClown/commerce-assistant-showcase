import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  EmptyState,
  Pagination,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from './ui';

describe('通用UI组件', () => {
  it('渲染按钮和业务状态', () => {
    render(
      <>
        <Button>保存门店</Button>
        <Badge tone="green">启用</Badge>
      </>,
    );
    expect(screen.getByRole('button', { name: '保存门店' })).toBeInTheDocument();
    expect(screen.getByText('启用')).toBeInTheDocument();
  });
  it('渲染空状态', () => {
    render(<EmptyState text="暂无订单" />);
    expect(screen.getByText('暂无订单')).toBeInTheDocument();
  });
  it('分页可前进且边界按钮禁用', () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pageSize={10} total={25} onPageChange={onChange} />);
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
  it('Skeleton 提供加载语义', () => {
    render(<Skeleton className="h-8" />);
    expect(screen.getByRole('status', { name: '正在加载' })).toHaveClass('animate-pulse');
  });
  it('Radix Tabs 切换内容', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">摘要</TabsTrigger>
          <TabsTrigger value="b">明细</TabsTrigger>
        </TabsList>
        <TabsContent value="a">摘要内容</TabsContent>
        <TabsContent value="b">明细内容</TabsContent>
      </Tabs>,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: '明细' }));
    fireEvent.click(screen.getByRole('tab', { name: '明细' }));
    expect(screen.getByText('明细内容')).toBeVisible();
  });
});
