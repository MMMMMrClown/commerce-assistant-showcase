'use client';

import { RotateCcw } from 'lucide-react';
import { MemberAvatar } from '@/components/member-avatar';
import { useEffect, useState } from 'react';
import {
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusTabs,
  Table,
  Td,
  Th,
  Button,
  Input,
  Pagination,
  Dialog,
  Sheet,
  useToast,
} from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { api, errorMessage, type PageResult } from '@/lib/api';
import { useAppSelector } from '@/store/store';
import { MemberOrders } from '@/components/orders/member-orders';
import { MemberBenefits } from '@/components/members/member-benefits';
import { CouponIssuer, MemberCoupons } from '@/components/members/member-coupons';
import type { BulkCouponTarget } from '@/lib/coupons';
import { discountText, type BenefitMember } from '@/lib/member-benefits';

type Member = BenefitMember;

// 会员状态标签页：key 对应后端 enabled 筛选值，空字符串代表全部会员
const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'true', label: '启用' },
  { key: 'false', label: '停用' },
] as const;

export default function MembersView() {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [sort, setSort] = useState({ by: '', direction: 'asc' });
  const sortColumn = (by: string) => {
    setPage(1);
    setSort((s) => ({ by, direction: s.by === by && s.direction === 'asc' ? 'desc' : 'asc' }));
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', birthday: '', enabled: true });
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [editing, setEditing] = useState<Member | null>(null);
  const [viewing, setViewing] = useState<Member | null>(null);
  const [benefitId, setBenefitId] = useState<string | null>(null);
  // 【发券交互状态】保存单人弹窗会员、跨页勾选ID、全量选择模式及本次批量目标。
  const [couponMember, setCouponMember] = useState<Member | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [batchTarget, setBatchTarget] = useState<BulkCouponTarget | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const { toast } = useToast();

  const canCreate = useAppSelector(
    (state) => state.auth.user?.permissions.includes('member:create') ?? false,
  );
  const canEdit = useAppSelector(
    (state) => state.auth.user?.permissions.includes('member:edit') ?? false,
  );
  const canViewOrders = useAppSelector(
    (state) => state.auth.user?.permissions.includes('order:view') ?? false,
  );
  const canManageBenefits = useAppSelector(
    (state) => state.auth.user?.permissions.includes('member:benefits-manage') ?? false,
  );
  // 【发券权限】决定是否显示批量选择、发券和模板管理操作；后端仍独立检查权限。
  const canIssueCoupons = useAppSelector(
    (state) => state.auth.user?.permissions.includes('member:coupon-issue') ?? false,
  );

  // 状态筛选由服务端分页处理。
  const url =
    `/members?sortBy=${sort.by}&sortDirection=${sort.direction}&page=${page}&pageSize=${pageSize}&keyword=${encodeURIComponent(keyword)}` +
    (status ? '&enabled=' + status : '');

  // 【会员列表接口】根据搜索词和页码查询会员，列表数据中已包含会员ID。
  const result = useApi<PageResult<Member>>(url);

  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  // 拉取各状态会员总数（每类只请求 1 条拿 total，列表增删后自动刷新计数）；
  // 两类总数取得状态计数，保存资料后同步刷新。
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<{ data: PageResult<Member> }>('/members?page=1&pageSize=1'),
      api.get<{ data: PageResult<Member> }>('/members?page=1&pageSize=1&enabled=true'),
    ])
      .then(([all, enabled]) => {
        if (!alive) return;
        const allTotal = all.data.data.total;
        const enabledTotal = enabled.data.data.total;
        setCounts({
          '': allTotal,
          true: enabledTotal,
          false: Math.max(0, allTotal - enabledTotal),
        });
      })
      .catch(() => {
        if (alive) setCounts(null);
      });
    return () => {
      alive = false;
    };
  }, [result.data?.total, revision]);

  const rawMembers = result.data?.items ?? [];
  const members = rawMembers;
  // 【当前页选择范围】只允许启用会员被勾选，并计算表头是否全选。
  const selectable = members.filter((member) => member.enabled);
  const pageSelected =
    selectable.length > 0 && selectable.every((member) => selectedIds.has(member.id));
  function clearSelection() {
    // 【清空选择】切换搜索条件或发券成功后，重置跨页勾选和全量选择。
    setSelectedIds(new Set());
    setSelectAll(false);
  }
  // 单个勾选跨页保留；全量选择传搜索条件到后端，避免仅给当前页发券。
  function toggleSelection(ids: string[], checked: boolean) {
    const next = new Set(selectedIds);
    ids.forEach((id) => {
      if (checked) next.add(id);
      else next.delete(id);
    });
    if (next.size > 1000) {
      toast({ title: '手动最多勾选1000位，请使用跨页全选', variant: 'error' });
      return;
    }
    setSelectAll(false);
    setSelectedIds(next);
  }

  const submit = async () => {
    if (saving) return;

    setSubmitError('');

    const name = form.name.trim();
    const phone = form.phone.trim();

    if (!name || !/^\d{11}$/.test(phone)) {
      setSubmitError('请填写会员姓名和11位手机号');
      return;
    }

    setSaving(true);

    try {
      if (editing) {
        await api.patch(`/members/${editing.id}`, {
          name,
          phone,
          birthday: form.birthday || null,
          enabled: form.enabled,
        });
      } else {
        await api.post('/members', {
          name,
          phone,
          birthday: form.birthday || null,
          enabled: form.enabled,
        });
      }

      setOpen(false);
      setEditing(null);
      setRevision((v) => v + 1);
      clearSelection();

      if (editing || (page === 1 && keyword === '')) {
        await result.reload();
      } else {
        setPage(1);
        setKeyword('');
      }
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        title="会员管理"
        description="管理会员资料、等级权益与积分"
        action={
          canCreate ? (
            <Button
              type="button"
              onClick={() => {
                setForm({ name: '', phone: '', birthday: '', enabled: true });
                setSubmitError('');
                setOpen(true);
                setEditing(null);
              }}
            >
              新增会员
            </Button>
          ) : undefined
        }
      />
      <StatusTabs
        tabs={STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
        counts={counts}
        value={status}
        onChange={(key) => {
          setStatus(key);
          setPage(1);
          clearSelection();
        }}
      />

      <Card className="p-5">
        <form
          className="mb-4 flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();

            void result.reload();
          }}
        >
          <Input
            className="max-w-sm"
            placeholder="搜索会员姓名或手机号"
            aria-label="搜索会员"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
              clearSelection();
            }}
          />

          <Button type="submit">查询</Button>
          {(keyword || status) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setKeyword('');
                setStatus('');
                setPage(1);
                clearSelection();
              }}
            >
              <RotateCcw size={15} />
              重置
            </Button>
          )}
        </form>
        {/* 【批量发券工具栏】显示选择数量，提供跨页全选、清空和打开批量发券弹窗。 */}
        {canIssueCoupons && (
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <span>
              {selectAll
                ? '已选择全部符合条件的启用会员（跨页）'
                : '已选择 ' + selectedIds.size + ' 位会员（可跨页勾选）'}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={result.loading || !!result.error || !members.length}
              onClick={() => {
                setSelectAll(true);
                setSelectedIds(new Set());
              }}
            >
              选择全部符合条件的会员
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={clearSelection}>
              清空选择
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!selectAll && !selectedIds.size}
              onClick={() =>
                setBatchTarget(
                  selectAll
                    ? { mode: 'ALL', keyword: keyword.trim() }
                    : { mode: 'SELECTED', memberIds: [...selectedIds] },
                )
              }
            >
              批量发券
            </Button>
          </div>
        )}
        {result.loading ? (
          <LoadingState />
        ) : result.error ? (
          <ErrorState message={result.error} retry={result.reload} />
        ) : members.length === 0 ? (
          <EmptyState text="暂无会员" />
        ) : (
          <Table>
            <thead>
              <tr>
                {canIssueCoupons && (
                  <Th>
                    <input
                      type="checkbox"
                      aria-label="全选当前页会员"
                      checked={selectAll || pageSelected}
                      disabled={!selectable.length}
                      ref={(node) => {
                        if (node)
                          node.indeterminate =
                            !selectAll &&
                            !pageSelected &&
                            selectable.some((member) => selectedIds.has(member.id));
                      }}
                      onChange={(event) => {
                        if (selectAll) clearSelection();
                        else
                          toggleSelection(
                            selectable.map((member) => member.id),
                            event.target.checked,
                          );
                      }}
                    />
                  </Th>
                )}
                <Th
                  onSort={() => sortColumn('name')}
                  direction={sort.by === 'name' ? sort.direction : undefined}
                >
                  会员姓名
                </Th>
                <Th
                  onSort={() => sortColumn('phone')}
                  direction={sort.by === 'phone' ? sort.direction : undefined}
                >
                  手机号
                </Th>
                <Th>生日</Th>
                <Th>等级 / 消费权益</Th>
                <Th
                  onSort={() => sortColumn('totalSpent')}
                  direction={sort.by === 'totalSpent' ? sort.direction : undefined}
                >
                  有效消费 / 积分
                </Th>
                <Th
                  onSort={() => sortColumn('enabled')}
                  direction={sort.by === 'enabled' ? sort.direction : undefined}
                >
                  状态
                </Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  {canIssueCoupons && (
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={'选择会员' + member.name}
                        checked={member.enabled && (selectAll || selectedIds.has(member.id))}
                        disabled={!member.enabled || selectAll}
                        onChange={(event) => toggleSelection([member.id], event.target.checked)}
                      />
                    </Td>
                  )}
                  <Td>
                    <div className="flex items-center gap-3">
                      <MemberAvatar name={member.name} src={member.avatarUrl} />
                      <span className="font-medium">{member.name}</span>
                    </div>
                  </Td>
                  <Td>{member.phone}</Td>
                  <Td>{member.birthday || '未填写'}</Td>
                  <Td>
                    <div
                      className={
                        member.tier !== 'STANDARD'
                          ? 'font-semibold text-orange-700 dark:text-orange-400'
                          : ''
                      }
                    >
                      {member.tierName}
                    </div>
                    <div className="mt-1 text-xs text-ink-muted">
                      {discountText(member.discountBps)} ·{' '}
                      {member.tierSource === 'MANUAL' ? '人工指定' : '自动等级'}
                    </div>
                  </Td>
                  <Td>
                    <div>¥{Number(member.totalSpent).toFixed(2)}</div>
                    <div className="mt-1 text-xs text-ink-muted">{member.points} 积分</div>
                  </Td>
                  <Td>
                    <Badge tone={member.enabled ? 'green' : 'neutral'}>
                      {member.enabled ? '启用' : '停用'}
                    </Badge>
                  </Td>
                  <Td>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost">
                          更多
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setBenefitId(member.id)}>
                          会员权益 / 等级调整
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setCouponMember(member)}>
                          {canIssueCoupons ? '发券 / 查看券' : '查看券'}
                        </DropdownMenuItem>
                        {canViewOrders && (
                          <DropdownMenuItem onSelect={() => setViewing(member)}>
                            查看订单
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {canEdit && (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={saving}
                          onClick={() => {
                            setEditing(member);
                            setForm({
                              name: member.name,
                              phone: member.phone,
                              birthday: member.birthday || '',
                              enabled: member.enabled,
                            });
                            setSubmitError('');
                            setOpen(true);
                          }}
                        >
                          编辑
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {result.data && !result.loading && !result.error && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={result.data.total}
            onPageChange={setPage}
          />
        )}
      </Card>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}
        title={editing ? '编辑会员' : '新增会员'}
        description="填写会员姓名和手机号"
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm">会员姓名</span>
            <Input
              placeholder="请输入姓名"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm">手机号</span>
            <Input
              type="tel"
              placeholder="请输入11位手机号"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm">生日（可选）</span>
            <Input
              type="date"
              min="1900-01-01"
              value={form.birthday}
              onChange={(e) => setForm({ ...form, birthday: e.target.value })}
            />
            <p className="mt-1 text-xs text-ink-muted">
              按上海日期计算，每自然年最多修改一次（首次填写计一次）；用于生日关怀，非闰年2月29日按2月28日。
            </p>
          </label>
          <fieldset className="rounded-lg border border-line bg-sunken/40 p-4" disabled={saving}>
            <legend className="px-1 text-sm font-medium">会员状态</legend>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="member-enabled"
                  checked={form.enabled}
                  onChange={() => setForm({ ...form, enabled: true })}
                />
                启用
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="member-enabled"
                  checked={!form.enabled}
                  onChange={() => setForm({ ...form, enabled: false })}
                />
                停用
              </label>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              停用后保留会员档案和历史记录，不能用于新订单或发券。
            </p>
          </fieldset>
          {submitError && (
            <div role="alert" className="rounded-lg bg-brick-tint p-3 text-sm text-brick">
              {submitError}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>

            <Button type="button" onClick={submit} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </Dialog>
      {viewing && <MemberOrders member={viewing} onClose={() => setViewing(null)} />}
      {/* 【单人券弹窗】传入选中的会员，弹窗自行查询会员券并处理发券和作废。 */}
      {couponMember && (
        <MemberCoupons
          member={couponMember}
          canIssue={canIssueCoupons}
          onClose={() => setCouponMember(null)}
        />
      )}
      {/* 【批量发券弹窗】传入冻结的会员ID或搜索条件，复用CouponIssuer发送批量请求。 */}
      {batchTarget && (
        <Sheet
          open
          title="批量发放优惠券"
          description={
            batchTarget.mode === 'ALL'
              ? batchTarget.keyword
                ? '给搜索“' + batchTarget.keyword + '”匹配的全部启用会员发券（包含其他页）'
                : '给全部启用会员发券（包含其他页）'
              : '给已选择的' + batchTarget.memberIds.length + '位会员，每人发放一张券'
          }
          onOpenChange={(open) => {
            if (!open && !batchBusy) setBatchTarget(null);
          }}
        >
          <p className="mb-4 text-sm text-ink-muted">
            仅向启用会员发放。每次确认每人一张；网络失败时保持模板不变并重试，避免重复发放。
          </p>
          <CouponIssuer
            target={batchTarget}
            onBusyChange={setBatchBusy}
            onIssued={() => {
              setBatchTarget(null);
              clearSelection();
            }}
          />
        </Sheet>
      )}
      {benefitId && (
        <MemberBenefits
          id={benefitId}
          canManage={canManageBenefits}
          canViewOrders={canViewOrders}
          onClose={() => setBenefitId(null)}
          onChanged={() => {
            void result.reload();
          }}
        />
      )}
    </>
  );
}
