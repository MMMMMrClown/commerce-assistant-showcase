'use client';
import { MemberAvatar } from '@/components/member-avatar';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/hooks/use-api';
import type { PageResult } from '@/lib/api';
import { couponStatusText, type CouponTemplate } from '@/lib/coupons';
import { MemberCoupons } from '@/components/members/member-coupons';
import { useAppSelector } from '@/store/store';
import {
  Button,
  Card,
  Input,
  Select,
  PageHeader,
  Table,
  Th,
  Td,
  Pagination,
  LoadingState,
  ErrorState,
  EmptyState,
  Badge,
} from '@/components/ui';
type RecordRow = {
  id: string;
  member: { id: string; name: string; phone: string; enabled: boolean; avatarUrl?: string | null };
  template: CouponTemplate;
  displayStatus: keyof typeof couponStatusText;
  createdAt: string;
  source: string;
  issuedBy: { name: string };
  batchId: string | null;
};
const sources: Record<string, string> = {
  MANUAL: '单人发券',
  BATCH: '批量发券',
  BIRTHDAY: '生日关怀',
  WELCOME: '新会员礼包',
};
// 【统一查询页】展示已有实际券记录，会员券操作继续复用原弹窗与接口。
export default function CouponRecords() {
  const params = useSearchParams(),
    router = useRouter(),
    templateId = params.get('templateId') || '';
  const [page, setPage] = useState(1),
    [draft, setDraft] = useState({ keyword: '', status: '', startDate: '', endDate: '' }),
    [filters, setFilters] = useState(draft),
    [member, setMember] = useState<RecordRow['member'] | null>(null);
  const canIssue = useAppSelector(
    (s) => s.auth.user?.permissions.includes('member:coupon-issue') ?? false,
  );
  const query = new URLSearchParams({
    page: String(page),
    ...(templateId ? { templateId } : {}),
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  });
  const result = useApi<PageResult<RecordRow>>('/coupons/records?' + query);
  return (
    <>
      <PageHeader
        title="优惠券发放记录"
        description="统一查看单人、批量及自动权益已产生的会员券，保留历史模板规则。"
      />
      <nav className="mb-5 flex gap-4 text-sm">
        {canIssue && <Link href="/marketing/coupons">优惠券模板 →</Link>}
        <Link href="/members">会员管理 →</Link>
      </nav>
      <Card className="p-5">
        {templateId && (
          <p className="mb-4 text-sm text-ink-muted">已限定券模板，重置可查看全部记录。</p>
        )}
        <form
          className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setFilters({ ...draft });
          }}
        >
          <Input
            aria-label="搜索发放记录"
            placeholder="会员或优惠券关键词"
            value={draft.keyword}
            onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
          />
          <Select
            aria-label="券状态"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <option value="">全部状态</option>
            {Object.entries(couponStatusText).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <label className="text-xs text-ink-muted">
            发放开始日期（上海）
            <Input
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            />
          </label>
          <label className="text-xs text-ink-muted">
            发放结束日期（上海）
            <Input
              type="date"
              value={draft.endDate}
              onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-4">
            <Button>查询</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const empty = { keyword: '', status: '', startDate: '', endDate: '' };
                setDraft(empty);
                setFilters(empty);
                setPage(1);
                router.replace('/marketing/coupons/records');
              }}
            >
              重置
            </Button>
            <Button type="button" variant="ghost" onClick={() => void result.reload()}>
              刷新
            </Button>
          </div>
        </form>
        {result.loading ? (
          <LoadingState />
        ) : result.error ? (
          <ErrorState message={result.error} retry={result.reload} />
        ) : (
          result.data && (
            <>
              {result.data.items.length ? (
                <Table>
                  <thead>
                    <tr>
                      {[
                        '会员',
                        '优惠券 / 原规则',
                        '来源 / 发放人',
                        '当前状态',
                        '发放时间',
                        '操作',
                      ].map((t) => (
                        <Th key={t}>{t}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.items.map((r) => (
                      <tr key={r.id}>
                        <Td>
                          <div className="flex items-center gap-2">
                            <MemberAvatar compact name={r.member.name} src={r.member.avatarUrl} />
                            <p>{r.member.name}</p>
                          </div>
                          <p className="text-xs text-ink-muted">{r.member.phone}</p>
                        </Td>
                        <Td>
                          <p className="font-medium">
                            {r.template.name} · V{r.template.version}
                          </p>
                          <p className="text-xs text-ink-muted">
                            满¥{r.template.minimumSpend}减¥{r.template.discountAmount}
                          </p>
                          <p className="text-xs">
                            {new Date(r.template.startsAt).toLocaleDateString('zh-CN')} ～{' '}
                            {new Date(r.template.endsAt).toLocaleDateString('zh-CN')}
                          </p>
                        </Td>
                        <Td>
                          {sources[r.source] || r.source}
                          <p className="text-xs text-ink-muted">{r.issuedBy.name}</p>
                        </Td>
                        <Td>
                          <span className="whitespace-nowrap">
                            <Badge tone={r.displayStatus === 'AVAILABLE' ? 'green' : 'neutral'}>
                              {couponStatusText[r.displayStatus]}
                            </Badge>
                          </span>
                        </Td>
                        <Td>{new Date(r.createdAt).toLocaleString('zh-CN')}</Td>
                        <Td>
                          <Button size="sm" variant="ghost" onClick={() => setMember(r.member)}>
                            会员券
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState text="暂无符合条件的发放记录" />
              )}
              <Pagination
                page={page}
                pageSize={20}
                total={result.data.total}
                onPageChange={setPage}
              />
            </>
          )
        )}
      </Card>
      {member && (
        <MemberCoupons
          member={member}
          canIssue={canIssue && member.enabled}
          onClose={() => {
            setMember(null);
            void result.reload();
          }}
        />
      )}
    </>
  );
}
