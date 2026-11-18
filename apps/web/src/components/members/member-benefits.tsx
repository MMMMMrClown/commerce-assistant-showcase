'use client';
import { MemberAvatar } from '@/components/member-avatar';
import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, errorMessage, type PageResult } from '@/lib/api';
import {
  discountText,
  overrideText,
  type BenefitAudit,
  type BenefitLedger,
  type BenefitSummary,
  type MemberTier,
  type MemberTierRule,
} from '@/lib/member-benefits';
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Pagination,
  Select,
  Sheet,
  Table,
  Td,
  Th,
  useToast,
} from '../ui';

export function MemberBenefits({
  id,
  canManage,
  canViewOrders,
  onClose,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  canViewOrders: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const result = useApi<BenefitSummary>('/member-benefits/members/' + id);
  const [tab, setTab] = useState<'summary' | 'ledger' | 'audits'>('summary');
  const [auditVersion, setAuditVersion] = useState(0);
  const data = result.data;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="会员权益详情"
      description="查看等级、有效消费、积分与权益变更"
    >
      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState message={result.error} retry={result.reload} />
      ) : (
        data && (
          <>
            <div className="mb-4 flex items-center gap-3 text-sm">
              <MemberAvatar name={data.member.name} src={data.member.avatarUrl} />
              <div>
                <p className="font-medium">{data.member.name}</p>
                <p className="text-ink-muted">{data.member.phone}</p>
              </div>
            </div>
            <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl bg-sunken p-4 text-sm dark:bg-sunken">
              {[
                ['会员等级', data.member.tierName],
                ['等级来源', data.member.tierSource === 'MANUAL' ? '人工指定' : '按有效消费计算'],
                ['累计有效实付', '¥' + Number(data.member.totalSpent).toFixed(2)],
                ['积分余额', String(data.member.points)],
                ['当前折扣', discountText(data.member.discountBps)],
                ['积分倍率', data.member.pointsPerYuan + '倍'],
                [
                  '等级进度',
                  data.member.tierSource === 'MANUAL'
                    ? '人工等级，可恢复自动'
                    : data.member.nextTier
                      ? '距' + data.member.nextTier.name + ' ¥' + data.member.nextTierAmount
                      : '已达最高等级',
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-ink-muted">{label}</p>
                  <p className="mt-1 font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <div className="mb-5 rounded-xl border border-line p-4 text-sm dark:border-line">
              <p className="font-medium">成长等级：{data.member.automaticTierName}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {data.member.nextTier
                  ? '再消费 ¥' + data.member.nextTierAmount + ' 成为' + data.member.nextTier.name
                  : '已解锁最高成长等级'}
              </p>
              <div
                role="progressbar"
                aria-label="会员成长进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={data.member.growthProgress}
                className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
              >
                <div
                  className="h-full rounded-full bg-orange-600 transition-all"
                  style={{ width: data.member.growthProgress + '%' }}
                />
              </div>
            </div>
            <div className="mb-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={tab === 'summary' ? 'default' : 'outline'}
                onClick={() => setTab('summary')}
              >
                权益说明
              </Button>
              {canViewOrders && (
                <Button
                  size="sm"
                  variant={tab === 'ledger' ? 'default' : 'outline'}
                  onClick={() => setTab('ledger')}
                >
                  积分流水
                </Button>
              )}
              {canManage && (
                <Button
                  size="sm"
                  variant={tab === 'audits' ? 'default' : 'outline'}
                  onClick={() => setTab('audits')}
                >
                  等级变更记录
                </Button>
              )}
            </div>
            {tab === 'summary' && (
              <div className="space-y-5">
                <p className="text-sm leading-7 text-ink-muted">
                  当前等级每满1元积{data.member.pointsPerYuan}分。成长等级按累计有效实付计算，
                  门槛不逐级清零，单次消费可以跨级晋升。
                  积分仅累积和查询，暂不支持抵扣。全额退款冲回原订单积分和有效消费，自动等级随有效消费重新计算；人工指定等级保持不变。
                </p>
                {!data.member.enabled && (
                  <p className="text-sm text-orange-700">该会员已停用，不能创建新订单。</p>
                )}
                {canManage && (
                  <TierEditor
                    key={data.member.tierOverride ?? 'AUTO'}
                    id={id}
                    initial={data.member.tierOverride}
                    tiers={data.policy.tiers}
                    onSaved={() => {
                      void result.reload();
                      setAuditVersion((value) => value + 1);
                      onChanged();
                    }}
                  />
                )}
              </div>
            )}
            {tab === 'ledger' && <Ledger id={id} />}
            {tab === 'audits' && <Audits key={auditVersion} id={id} tiers={data.policy.tiers} />}
          </>
        )
      )}
    </Sheet>
  );
}

function TierEditor({
  id,
  initial,
  tiers,
  onSaved,
}: {
  id: string;
  initial: MemberTier | null;
  tiers: MemberTierRule[];
  onSaved: () => void;
}) {
  const [tier, setTier] = useState<string>(initial ?? 'AUTO');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();
  async function save() {
    if (saving) return;
    if (reason.trim().length < 2) {
      setError('请填写至少2个字的等级调整原因');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.patch('/member-benefits/members/' + id + '/tier', {
        tierOverride: tier === 'AUTO' ? null : tier,
        reason: reason.trim(),
      });
      setReason('');
      toast({ title: '会员等级已更新', variant: 'success' });
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="space-y-3 rounded-xl border border-line p-4 dark:border-line"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3 className="font-medium">等级管理</h3>
      <fieldset disabled={saving} className="space-y-3">
        <label className="block text-sm">
          等级方式
          <Select
            className="mt-2 w-full"
            value={tier}
            onChange={(event) => setTier(event.target.value)}
          >
            <option value="AUTO">自动等级（按累计有效消费）</option>
            {tiers.map((rule) => (
              <option key={rule.code} value={rule.code}>
                人工指定{rule.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          调整原因
          <Input
            className="mt-2"
            value={reason}
            maxLength={200}
            placeholder="例如：客户活动赠送VIP权益"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-brick">
          {error}
        </p>
      )}
      <Button size="sm" disabled={saving}>
        {saving ? '保存中…' : '保存等级'}
      </Button>
    </form>
  );
}

function Ledger({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const result = useApi<PageResult<BenefitLedger>>(
    '/member-benefits/members/' + id + '/ledger?page=' + page,
  );
  return (
    <>
      <p className="mb-3 text-xs text-ink-muted">
        积分余额全门店通用；此处只显示你有权查看的门店流水。
      </p>
      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState message={result.error} retry={result.reload} />
      ) : !result.data?.items.length ? (
        <EmptyState text="暂无已入账积分流水" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>时间 / 门店</Th>
                <Th>业务</Th>
                <Th>有效消费变动</Th>
                <Th>积分变动</Th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((entry) => (
                <tr key={entry.id}>
                  <Td>
                    <div className="whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-ink-muted">{entry.order.store.name}</div>
                  </Td>
                  <Td>{entry.kind === 'PAYMENT' ? '消费入账' : '退款冲回'}</Td>
                  <Td>¥{Number(entry.amount).toFixed(2)}</Td>
                  <Td>
                    {entry.pointsDelta > 0 ? '+' : ''}
                    {entry.pointsDelta}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={10} total={result.data.total} onPageChange={setPage} />
        </>
      )}
    </>
  );
}

function Audits({ id, tiers }: { id: string; tiers: MemberTierRule[] }) {
  const result = useApi<BenefitAudit[]>('/member-benefits/members/' + id + '/audits');
  return result.loading ? (
    <LoadingState />
  ) : result.error ? (
    <ErrorState message={result.error} retry={result.reload} />
  ) : !result.data?.length ? (
    <EmptyState text="暂无等级变更记录" />
  ) : (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">最近20条人工等级变更</p>
      {result.data.map((entry) => (
        <div key={entry.id} className="rounded-xl border border-line p-4 text-sm dark:border-line">
          <p className="font-medium">
            {overrideText(entry.before.tierOverride, tiers)} →{' '}
            {overrideText(entry.after.tierOverride, tiers)}
          </p>
          <p className="mt-2">{entry.reason}</p>
          <p className="mt-2 text-xs text-ink-muted">
            {entry.actor?.name ?? '历史操作人'} · {new Date(entry.createdAt).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}
