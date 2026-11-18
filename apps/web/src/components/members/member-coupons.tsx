'use client';
import { MemberAvatar } from '@/components/member-avatar';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/use-api';
import { api, errorMessage } from '@/lib/api';
import {
  couponStatusText,
  type BulkCouponTarget,
  type CouponTemplate,
  type MemberCoupon,
} from '@/lib/coupons';
import { money } from '@/lib/orders';
import {
  Button,
  Table,
  Th,
  Td,
  Badge,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  Sheet,
  useToast,
} from '../ui';

// 【会员券弹窗】查询当前会员拥有的券，并提供发券、查券和作废操作。
export function MemberCoupons({
  member,
  canIssue,
  onClose,
}: {
  member: { id: string; name: string; enabled: boolean; avatarUrl?: string | null };
  canIssue: boolean;
  onClose: () => void;
}) {
  // 【查询接口】获取该会员已经拥有的券，供弹窗下方列表展示；不是查询发券模板。
  const result = useApi<MemberCoupon[]>('/coupons/members/' + member.id);
  // 【操作状态】记录待作废的券、错误信息和处理中状态，用于确认操作、防连点和限制关窗。
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [issueBusy, setIssueBusy] = useState(false);
  async function voidCoupon() {
    // 【提交校验】必须先选中要作废的券；正在处理时不重复提交。
    if (!voidId || voiding) return;
    setVoiding(true);
    setVoidError('');
    try {
      // 【作废接口】通知后端作废这位会员的一张未占用券。
      await api.delete('/coupons/members/' + member.id + '/coupons/' + voidId);
      // 【列表刷新】作废成功后关闭确认区域，重新查询会员券，更新“已作废”状态。
      setVoidId(null);
      void result.reload();
    } catch (error) {
      // 【失败反馈】把后端拒绝原因显示在弹窗中；最终恢复可操作状态。
      setVoidError(errorMessage(error));
    } finally {
      setVoiding(false);
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        // 【关闭控制】发券或作废处理中暂不允许关窗，避免丢失本次操作状态。
        if (!open && !issueBusy && !voiding) onClose();
      }}
      title="会员优惠券"
      description={member.name + ' · 发放和查看满减券'}
    >
      <div className="mb-4 flex items-center gap-2">
        <MemberAvatar name={member.name} src={member.avatarUrl} />
        <span>{member.name}</span>
      </div>
      {/* 【发券区域】有发券权限且会员启用时，显示模板选择和发券操作。 */}
      {canIssue && member.enabled && (
        <CouponIssuer
          memberId={member.id}
          onBusyChange={setIssueBusy}
          onIssued={() => {
            // 【发券后刷新】子组件发券成功后，重新加载当前会员的券列表。
            void result.reload();
          }}
        />
      )}
      {!member.enabled && (
        <p className="mb-4 text-sm text-orange-700">会员已停用，暂不能发券或下单。</p>
      )}
      <p className="mb-3 text-sm text-ink-muted">
        全门店、全商品通用；与会员折扣不叠加。创建订单占用，支付完成后才核销。
      </p>
      {voidError && (
        <p role="alert" className="mb-3 text-sm text-brick">
          {voidError}
        </p>
      )}
      {/* 【查询结果展示】按加载中、失败、无券、有券四种情况显示列表。 */}
      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState message={result.error} retry={result.reload} />
      ) : !result.data?.length ? (
        <EmptyState text="该会员暂无优惠券" />
      ) : (
        <div className="space-y-3">
          {result.data.map((coupon) => (
            <div
              key={coupon.id}
              className="rounded-xl border border-line p-4 text-sm dark:border-line"
            >
              <p className="flex justify-between gap-3 font-medium">
                <span>{coupon.template.name}</span>
                <span>{couponStatusText[coupon.displayStatus]}</span>
              </p>
              <p className="mt-2">
                满 {money(coupon.template.minimumSpend)} 减 {money(coupon.template.discountAmount)}
              </p>
              <p className="mt-2 text-xs text-ink-muted">
                {new Date(coupon.template.startsAt).toLocaleString()} ～{' '}
                {new Date(coupon.template.endsAt).toLocaleString()}
              </p>
              {/* 【作废入口】未占用的券才显示操作；点击后先确认，再调用作废接口。 */}
              {canIssue &&
                coupon.status === 'AVAILABLE' &&
                (voidId === coupon.id ? (
                  <div className="mt-3 space-y-2">
                    <p>作废后该会员不能再使用这张券，确认作废？</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={voiding}
                      onClick={() => void voidCoupon()}
                    >
                      确认作废
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={voiding}
                      onClick={() => setVoidId(null)}
                    >
                      取消作废
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={voiding}
                    onClick={() => {
                      setVoidId(coupon.id);
                      setVoidError('');
                    }}
                  >
                    作废此券
                  </Button>
                ))}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// 【发券与模板管理】单人发券和批量发券共用这块界面，同时提供模板新建、修改、删除。
export function CouponIssuer({
  memberId,
  target,
  onIssued,
  onBusyChange,
  templatesOnly = false,
}: {
  templatesOnly?: boolean;
  memberId?: string;
  target?: BulkCouponTarget;
  onIssued: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  // 【查询接口】获取可管理的券模板，填充“发券模板”下拉框；不是会员已有券。
  const templates = useApi<CouponTemplate[]>('/coupons/templates');
  // 【表单与处理状态】保存选中的模板、编辑/删除区域、错误和忙碌状态。
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CouponTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const busy = useRef(false);
  const { toast } = useToast();
  async function issue() {
    // 【提交校验与防连点】未选模板或已有请求正在处理时，不发起新请求。
    if (busy.current || !selected) return;
    busy.current = true;
    onBusyChange?.(true);
    setSaving(true);
    setError('');
    // 网络重试沿用同一次发券标识，避免点击重试又多发一张券。
    requestId.current ??= crypto.randomUUID();
    try {
      // 【发券接口】有批量目标走批次接口，否则给指定会员发券；提交模板ID和防重标识。
      const response = await api.post(
        target ? '/coupons/batches' : '/coupons/members/' + memberId,
        {
          ...target,
          templateId: selected,
          requestId: requestId.current,
        },
      );
      // 【成功反馈与刷新通知】清空选择，提示发放结果，通知外层刷新列表或关闭批量窗口。
      setSelected('');
      requestId.current = null;
      toast({
        title: target ? '已向' + response.data.data.count + '位会员发券' : '优惠券已发放',
        variant: 'success',
      });
      onIssued();
    } catch (err) {
      // 【失败反馈】保留本次提交标识供重试；请求结束后恢复按钮和关窗操作。
      setError(errorMessage(err));
    } finally {
      busy.current = false;
      onBusyChange?.(false);
      setSaving(false);
    }
  }
  async function deleteTemplate() {
    // 【删除校验】必须选中模板，且没有正在处理的操作。
    if (!selected || busy.current) return;
    busy.current = true;
    onBusyChange?.(true);
    setSaving(true);
    setError('');
    try {
      // 【删除接口】停止该模板后续发放，已发会员券不随模板删除而失效。
      await api.delete('/coupons/templates/' + selected);
      // 【模板刷新】清空旧选择和确认区域，重新查询模板下拉框。
      setSelected('');
      setDeleting(false);
      setCreating(false);
      requestId.current = null;
      void templates.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busy.current = false;
      onBusyChange?.(false);
      setSaving(false);
    }
  }
  const selectedTemplate = templates.data?.find((template) => template.id === selected);
  return (
    <div
      className={
        templatesOnly
          ? 'mb-6 space-y-4 rounded-xl border border-line bg-surface p-5'
          : 'mb-6 space-y-3 rounded-xl bg-sunken p-4 dark:bg-sunken'
      }
    >
      <h3 className="font-medium">
        {templatesOnly ? '优惠券模板管理' : target ? '批量发券' : '给该会员发券'}
      </h3>
      {templatesOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => {
            setCreating(!creating);
            setEditing(null);
            setDeleting(false);
          }}
        >
          {creating ? '收起模板表单' : '新建满减券模板'}
        </Button>
      )}
      {templates.error ? (
        <ErrorState message={templates.error} retry={templates.reload} />
      ) : (
        <>
          {templatesOnly ? (
            templates.loading ? (
              <LoadingState />
            ) : !templates.data?.length ? (
              <EmptyState text="暂无优惠券模板" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    {['优惠券名称', '使用门槛', '优惠金额', '有效期', '状态', '操作'].map((v) => (
                      <Th key={v}>{v}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {templates.data?.map((t) => (
                    <tr key={t.id}>
                      <Td>
                        <span className="font-medium">{t.name}</span>
                        <p className="text-xs text-ink-muted">V{t.version}</p>
                      </Td>
                      <Td>满 {money(t.minimumSpend)}</Td>
                      <Td>{money(t.discountAmount)}</Td>
                      <Td>
                        <p className="text-xs">{new Date(t.startsAt).toLocaleString('zh-CN')}</p>
                        <p className="text-xs">至 {new Date(t.endsAt).toLocaleString('zh-CN')}</p>
                      </Td>
                      <Td>
                        <Badge
                          tone={new Date(t.endsAt).getTime() <= Date.now() ? 'neutral' : 'green'}
                        >
                          {new Date(t.endsAt).getTime() <= Date.now()
                            ? '已过期'
                            : new Date(t.startsAt).getTime() > Date.now()
                              ? '未开始'
                              : '有效'}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving}
                            onClick={() => {
                              setSelected(t.id);
                              setEditing(t);
                              setCreating(true);
                              setDeleting(false);
                            }}
                          >
                            编辑
                          </Button>
                          <Link
                            className="inline-flex items-center whitespace-nowrap px-2 text-xs"
                            href={
                              '/marketing/coupons/records?templateId=' + encodeURIComponent(t.id)
                            }
                          >
                            发放记录
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving}
                            onClick={() => {
                              setSelected(t.id);
                              setDeleting(true);
                              setCreating(false);
                            }}
                          >
                            停止发放
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          ) : (
            <Select
              aria-label="发券模板"
              className="w-full"
              disabled={saving || templates.loading}
              value={selected}
              onChange={(e) => {
                // 【选择模板】保存模板ID，并清理上一份表单、错误和发券提交标识。
                setSelected(e.target.value);
                requestId.current = null;
                setError('');
                setCreating(false);
                setEditing(null);
                setDeleting(false);
              }}
            >
              <option value="">请选择满减券模板</option>
              {templates.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · 满{t.minimumSpend}减{t.discountAmount}
                  {' · V' + t.version}
                  {new Date(t.endsAt).getTime() <= Date.now() ? '（已过期）' : ''}
                </option>
              ))}
            </Select>
          )}
          {/* 【发券按钮】模板有效且不在编辑、删除或请求中时，允许调用 issue()。 */}
          {!templatesOnly && (
            <Button
              type="button"
              disabled={
                saving ||
                !selectedTemplate ||
                new Date(selectedTemplate.endsAt).getTime() <= Date.now() ||
                deleting ||
                creating
              }
              onClick={() => void issue()}
            >
              {saving ? '发放中…' : '确认发券'}
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-brick">
          {error}。如遇网络错误，请保持模板不变并重试。
        </p>
      )}
      {/* 【模板管理入口】下面三个按钮分别打开新建表单、编辑表单和删除确认区域。 */}
      {!templatesOnly && (
        <Link
          className="inline-block text-sm text-orange-700 underline-offset-4 hover:underline"
          href="/marketing/coupons"
        >
          管理优惠券模板 →
        </Link>
      )}
      {/* 【删除确认】明确确认后才调用删除接口，避免选中模板就直接删除。 */}
      {deleting && (
        <div className="space-y-2 text-sm">
          <p>确认停止发放“{selectedTemplate?.name}”？已发出的券仍按原规则使用。</p>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={saving}
            onClick={() => void deleteTemplate()}
          >
            确认停止发放
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => setDeleting(false)}
          >
            取消
          </Button>
        </div>
      )}
      {/* 【新建/编辑表单】有 editing 时回填旧规则；保存成功后刷新模板并选中新版本。 */}
      {creating && (
        <TemplateForm
          key={editing?.id ?? 'new'}
          initial={editing}
          onCreated={(id) => {
            // 【保存后刷新】重新加载模板，选中刚保存的模板，并收起表单。
            void templates.reload();
            setSelected(id);
            requestId.current = null;
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// 【模板表单】填写名称、门槛、减免金额和有效期；新建、修改共用一份表单。
function TemplateForm({
  initial,
  onCreated,
}: {
  initial?: CouponTemplate | null;
  onCreated: (id: string) => void;
}) {
  // 【时间回填】把接口返回的时间转成本地时间，供日期输入框显示。
  const localDate = (value: string) => {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  // 【表单回填】修改时使用原模板内容，新建时使用默认满30减5和空有效期。
  const [form, setForm] = useState(
    initial
      ? {
          name: initial.name,
          minimumSpend: initial.minimumSpend,
          discountAmount: initial.discountAmount,
          startsAt: localDate(initial.startsAt),
          endsAt: localDate(initial.endsAt),
        }
      : {
          name: '满30减5',
          minimumSpend: '30',
          discountAmount: '5',
          startsAt: '',
          endsAt: '',
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    // 【防重复提交】处理期间忽略再次保存，清空上一条错误。
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      // 【请求数据整理】把本地输入的有效期转换成接口统一使用的时间格式。
      const payload = {
        ...form,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      };
      // 【保存接口】新建走 POST，修改走 PATCH 并携带版本；字段和业务规则由后端再次校验。
      const response = initial
        ? await api.patch('/coupons/templates/' + initial.id, {
            ...payload,
            version: initial.version,
          })
        : await api.post('/coupons/templates', payload);
      // 【保存后通知】把新模板ID交回外层，由外层刷新模板列表。
      onCreated(response.data.data.id as string);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  // 编辑发布新版本，已发出的券继续使用原版本规则。
  return (
    <form
      className="space-y-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={saving} className="space-y-3">
        {/* 【表单校验】输入框限制必填、名称长度、金额范围；后端仍会独立校验。 */}
        {initial && (
          <p className="text-sm text-ink-muted">修改只影响后续发券，已发出的券保持原规则。</p>
        )}
        <label className="block text-sm">
          券名称
          <Input
            className="mt-1"
            required
            minLength={2}
            maxLength={40}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          使用门槛（元）
          <Input
            className="mt-1"
            type="number"
            required
            min="0.01"
            max="99999999.99"
            step="0.01"
            value={form.minimumSpend}
            onChange={(e) => setForm({ ...form, minimumSpend: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          减免金额（元）
          <Input
            className="mt-1"
            type="number"
            required
            min="0.01"
            max={form.minimumSpend}
            step="0.01"
            value={form.discountAmount}
            onChange={(e) => setForm({ ...form, discountAmount: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          开始时间
          <Input
            className="mt-1"
            type="datetime-local"
            required
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          结束时间
          <Input
            className="mt-1"
            type="datetime-local"
            required
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
          />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-brick">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? '保存中…' : initial ? '保存修改' : '保存模板'}
      </Button>
    </form>
  );
}
