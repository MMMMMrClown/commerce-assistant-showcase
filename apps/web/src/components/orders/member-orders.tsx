'use client';
import { MemberAvatar } from '@/components/member-avatar';

import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import type { PageResult } from '@/lib/api';
import type { MemberSummary, Order } from '@/lib/orders';
import { EmptyState, ErrorState, LoadingState, Pagination, Sheet } from '../ui';
import { OrderTable } from './order-table';
import { OrderDetail } from './order-detail';

export function MemberOrders({ member, onClose }: { member: MemberSummary; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const result = useApi<PageResult<Order>>(
    '/members/' + member.id + '/orders?page=' + page + '&pageSize=10',
  );
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={member.name + '的订单'}
        description={member.phone + ' · 仅显示你有权查看的门店订单'}
      >
        <div className="mb-4 flex items-center gap-2">
          <MemberAvatar name={member.name} src={member.avatarUrl} />
          <span>{member.name}</span>
        </div>
        {result.loading ? (
          <LoadingState />
        ) : result.error ? (
          <ErrorState message={result.error} retry={result.reload} />
        ) : !result.data?.items.length ? (
          <EmptyState text="当前数据范围内暂无关联订单" />
        ) : (
          <>
            <OrderTable orders={result.data.items} onView={setSelectedId} />
            <Pagination
              page={page}
              pageSize={10}
              total={result.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Sheet>
      {selectedId && (
        <OrderDetail
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void result.reload()}
        />
      )}
    </>
  );
}
