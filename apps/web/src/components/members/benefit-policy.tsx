'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, errorMessage } from '@/lib/api';
import { discountText, type BenefitPolicy, type MemberTierRule } from '@/lib/member-benefits';
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  Input,
  LoadingState,
  Table,
  Th,
  Td,
  Badge,
  useToast,
} from '../ui';

export function BenefitPolicyCard({
  canManage,
  onChanged,
  mode = 'tiers',
}: {
  mode?: 'tiers' | 'benefits';
  canManage: boolean;
  onChanged: () => void;
}) {
  const result = useApi<BenefitPolicy>('/member-benefits/policy');
  const [editing, setEditing] = useState<string | null>(null);
  const policy = result.data;
  return (
    <Card className="mb-5 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{mode === 'tiers' ? '等级规则' : '等级权益'}</h2>
          <p className="mt-1 text-xs text-ink-muted">
            累计有效实付自动升级 · 等级成长与积分余额分别记录
          </p>
        </div>
        {canManage && policy && (
          <Button size="sm" variant="outline" onClick={() => setEditing('settings')}>
            折扣设置
          </Button>
        )}
      </div>
      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState message={result.error} retry={result.reload} />
      ) : (
        policy && (
          <>
            {mode === 'tiers' ? (
              <Table>
                <thead>
                  <tr>
                    {[
                      '等级',
                      '等级名称',
                      '升级门槛（累计净实付）',
                      '会员折扣',
                      '积分倍率',
                      '操作',
                    ].map((label) => (
                      <Th key={label}>{label}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {policy.tiers.map((tier, index) => (
                    <tr key={tier.code}>
                      <Td>
                        <Badge tone="neutral">LV.{index}</Badge>
                      </Td>
                      <Td>
                        <span className="font-medium">{tier.name}</span>
                      </Td>
                      <Td>
                        {index === 0
                          ? '加入即享'
                          : '¥' +
                            Number(tier.minimumSpend).toLocaleString('zh-CN', {
                              minimumFractionDigits: 2,
                            })}
                      </Td>
                      <Td>{policy.enabled ? discountText(tier.discountBps) : '已暂停'}</Td>
                      <Td>{tier.pointsPerYuan} 倍</Td>
                      <Td>
                        {canManage ? (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(tier.code)}>
                            编辑
                          </Button>
                        ) : (
                          '—'
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>权益名称</Th>
                    <Th>适用等级与规则</Th>
                    <Th>生效方式</Th>
                    <Th>状态</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td>
                      <span className="whitespace-nowrap">会员折扣</span>
                    </Td>
                    <Td>
                      <div className="flex max-w-xl flex-wrap gap-x-5 gap-y-2">
                        {policy.tiers.map((t) => (
                          <span key={t.code} className="text-sm">
                            {t.name} · {discountText(t.discountBps)}
                          </span>
                        ))}
                      </div>
                    </Td>
                    <Td>下单时按等级计价，历史订单保留原规则</Td>
                    <Td>
                      <span className="whitespace-nowrap">
                        <Badge tone={policy.enabled ? 'green' : 'neutral'}>
                          {policy.enabled ? '已启用' : '已暂停'}
                        </Badge>
                      </span>
                    </Td>
                  </tr>
                  <tr>
                    <Td>
                      <span className="whitespace-nowrap">积分累积</span>
                    </Td>
                    <Td>
                      <div className="flex max-w-xl flex-wrap gap-x-5 gap-y-2">
                        {policy.tiers.map((t) => (
                          <span key={t.code} className="text-sm">
                            {t.name} · {t.pointsPerYuan} 倍
                          </span>
                        ))}
                      </div>
                    </Td>
                    <Td>确认付款入账，退款按原流水冲回；目前支持累积与查询</Td>
                    <Td>
                      <span className="whitespace-nowrap">
                        <Badge tone="green">已启用</Badge>
                      </span>
                    </Td>
                  </tr>
                </tbody>
              </Table>
            )}
            <p className="mt-4 text-xs leading-6 text-ink-muted">
              门槛按历次确认付款的累计净实付计算，升级不清零，可跨级晋升；退款冲回后重新计算。积分按下单等级的倍率入账，当前仅累积与查询。
            </p>
          </>
        )
      )}
      {editing && policy && (
        <PolicyEditor
          policy={policy}
          tierCode={editing === 'settings' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void result.reload();
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function PolicyEditor({
  policy,
  tierCode,
  onClose,
  onSaved,
}: {
  policy: BenefitPolicy;
  tierCode: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tiers, setTiers] = useState(
    policy.tiers.map((tier) => ({ ...tier, percent: String(tier.discountBps / 100) })),
  );
  const [enabled, setEnabled] = useState(policy.enabled);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();
  function change(
    index: number,
    key: 'name' | 'minimumSpend' | 'percent' | 'pointsPerYuan',
    value: string,
  ) {
    setTiers((previous) =>
      previous.map((tier, i) =>
        i === index ? { ...tier, [key]: key === 'pointsPerYuan' ? Number(value) : value } : tier,
      ),
    );
  }
  async function save() {
    if (saving) return;
    const rules: MemberTierRule[] = tiers.map(({ percent, ...tier }) => ({
      ...tier,
      discountBps: Math.round(Number(percent) * 100),
    }));
    if (
      reason.trim().length < 2 ||
      rules.some(
        (tier) =>
          !tier.name.trim() ||
          !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(tier.minimumSpend) ||
          !Number.isFinite(tier.discountBps) ||
          tier.discountBps < 5000 ||
          tier.discountBps > 10000 ||
          !Number.isInteger(tier.pointsPerYuan) ||
          tier.pointsPerYuan < 1 ||
          tier.pointsPerYuan > 10,
      )
    ) {
      setError('请检查各档名称、门槛、支付比例(50～100)、积分倍率(1～10)，并填写变更原因');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.patch('/member-benefits/policy', {
        enabled,
        tiers: rules,
        version: policy.version,
        reason: reason.trim(),
      });
      toast({ title: '成长会员规则已更新', variant: 'success' });
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={
        tierCode
          ? '编辑等级 · ' + (policy.tiers.find((t) => t.code === tierCode)?.name || '')
          : '会员折扣设置'
      }
      description="门槛按累计有效实付计算，须逐级递增；高等级权益不能降低。新规则不改历史订单快照。"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={saving} className="space-y-4">
          <div className="space-y-3">
            {tiers.map(
              (tier, index) =>
                tier.code === tierCode && (
                  <div
                    key={tier.code}
                    className="rounded-xl border border-line p-3 dark:border-line"
                  >
                    <p className="mb-3 text-xs font-semibold text-ink-muted">
                      LV.{index} · {tier.name}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs">
                        等级名称
                        <Input
                          className="mt-1"
                          aria-label={'等级名称' + index}
                          value={tier.name}
                          maxLength={20}
                          onChange={(event) => change(index, 'name', event.target.value)}
                        />
                      </label>
                      <label className="text-xs">
                        累计门槛（元）
                        <Input
                          className="mt-1"
                          aria-label={'累计门槛' + index}
                          disabled={index === 0}
                          value={tier.minimumSpend}
                          onChange={(event) => change(index, 'minimumSpend', event.target.value)}
                        />
                      </label>
                      <label className="text-xs">
                        支付比例（%）
                        <Input
                          className="mt-1"
                          aria-label={'支付比例' + index}
                          type="number"
                          min={50}
                          max={100}
                          step={0.01}
                          disabled={index === 0}
                          value={tier.percent}
                          onChange={(event) => change(index, 'percent', event.target.value)}
                        />
                      </label>
                      <label className="text-xs">
                        积分倍率
                        <Input
                          className="mt-1"
                          aria-label={'积分倍率' + index}
                          type="number"
                          min={1}
                          max={10}
                          step={1}
                          value={tier.pointsPerYuan}
                          onChange={(event) => change(index, 'pointsPerYuan', event.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                ),
            )}
          </div>
          {!tierCode && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              启用会员折扣
            </label>
          )}
          <label className="block text-sm">
            变更原因
            <Input
              className="mt-2"
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：调整成长会员权益"
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-brick">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button disabled={saving}>{saving ? '保存中…' : '保存规则'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
