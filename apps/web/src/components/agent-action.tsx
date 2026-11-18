'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import { Button } from './ui';
import { MemberAvatar } from './member-avatar';
import { SeckillProposalEditor } from './seckill-proposal-editor';
import { AgentBatchOrders, type BatchPreview, type BatchOutcome } from './agent-batch-orders';
import {
  AgentBatchOperations,
  type BatchOperationPreview,
  type BatchOperationOutcome,
} from './agent-batch-operations';
export type AgentAction = {
  runId?: string;
  id: string;
  kind: string;
  status: string;
  version: number;
  payloadHash: string;
  expiresAt: string;
  result?: {
    failure?: { message: string; nextActions?: string[] };
    id?: string;
    orderNo?: string;
    status?: string;
    attempt?: number;
    batchId?: string;
    count?: number;
    succeeded?: number;
    failed?: number;
    pending?: number;
    rows?: BatchOutcome['rows'] | BatchOperationOutcome['rows'];
  };
  payload: {
    batchParentKey?: string;
    batchOperations?: BatchOperationPreview;
    batch?: BatchPreview;
    replacesActionId?: string;
    proposal?: { rationale: string; basis: string; notice: string };
    fields?: { label: string; before: unknown; after: unknown }[];
    summary?: {
      productName?: string;
      regularPrice?: string;
      name?: string;
      templateName?: string;
      minimumSpend?: string;
      discountAmount?: string;
      startsAt?: string;
      endsAt?: string;
      enabled?: boolean;
      remainingStock?: number;
      count?: number;
      recipients?: { id: string; name: string; maskedPhone: string }[];
    };
    before?: { name: string; maskedPhone: string };
    input?: {
      name: string;
      code?: string;
      categoryId?: string;
      costPrice?: string;
      maskedPhone?: string;
      memberId?: string;
      productId?: string;
      price?: string;
      stock?: number;
      startsAt?: string;
      endsAt?: string;
      holdMinutes?: number;
    };
    reason?: string;
    member?: { name: string; maskedPhone: string };
    quote?: {
      memberName: string;
      storeName: string;
      originalAmount: string;
      discountAmount: string;
      payableAmount: string;
      items: { productName: string; quantity: number; subtotal: string }[];
      benefitSnapshot?: { source: string };
    };
    order?: { orderNo: string; status: string; payableAmount: string; paidAmount: string };
  };
};
const labels: Record<string, string> = {
  BATCH_OPERATIONS: '确认批量业务操作',
  ORDER_SHIP: '确认模拟发货',
  ORDER_RECEIVE: '确认模拟收货',
  PRODUCT_STOCK: '确认调整商品库存',
  BENEFIT_POLICY: '确认修改全平台会员权益',
  MEMBER_TIER: '确认调整会员等级',
  IMPORT_CONFIRM: '确认导入历史订单',
  METRIC_STATUS: '确认调整指标展示',
  PRODUCT_EDIT: '确认修改商品资料',
  EDIT_MEMBER: '确认修改会员资料',
  COUPON_TEMPLATE_UPDATE: '确认发布券模板新版本',
  COUPON_TEMPLATE_DISABLE: '确认停止模板发放',
  COUPON_VOID: '确认作废会员券',
  ROLE_CREATE: '确认新增角色',
  ROLE_EDIT: '确认修改角色权限',
  USER_CREATE: '确认新增后台用户',
  USER_EDIT: '确认修改后台用户',
  CATEGORY_CREATE: '确认新增商品分类',
  CATEGORY_EDIT: '确认修改商品分类',
  REGION_CREATE: '确认新增区域',
  REGION_EDIT: '确认修改区域',
  STORE_CREATE: '确认新增门店',
  STORE_EDIT: '确认修改门店',
  PRODUCT_CREATE: '确认新增商品',
  PRODUCT_RENAME: '确认修改商品名称',
  COUPON_TEMPLATE_CREATE: '确认创建满减券模板',
  COUPON_ISSUE: '确认向指定会员发券',
  SECKILL_TOGGLE: '确认调整秒杀状态',
  CREATE_MEMBER: '确认新增会员',
  RENAME_MEMBER: '确认修改会员姓名',
  CREATE_SECKILL: '确认发布秒杀活动',
  CREATE_ORDER: '确认创建待支付订单',
  BATCH_CREATE_ORDERS: '确认批量创建待支付订单',
  CANCEL_ORDER: '确认取消订单',
  PAYMENT: '确认发起模拟支付',
  REFUND: '确认申请整单退款',
};
const statuses: Record<string, string> = {
  WAITING_CONFIRMATION: '等待确认',
  EXECUTING: '正在核对执行结果',
  UNKNOWN: '结果未知，请核对恢复',
  SUCCEEDED: '操作已执行',
  FAILED: '操作失败，请重新预览',
  EXPIRED: '预览已失效',
  REJECTED: '已拒绝',
};
export function AgentActionCard({
  action: initial,
  onChanged,
  disabled,
  onReplaced,
}: {
  action: AgentAction;
  onChanged?: () => void;
  disabled?: boolean;
  onReplaced?: (action: AgentAction) => void;
}) {
  const [action, setAction] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const expired =
    action.status === 'WAITING_CONFIRMATION' && new Date(action.expiresAt).getTime() <= clock;
  useEffect(() => {
    if (action.status !== 'WAITING_CONFIRMATION') return;
    const remaining = new Date(action.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    if (remaining <= 0) {
      if (clock < new Date(action.expiresAt).getTime()) setClock(Date.now());
      return;
    }
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.min(Math.max(remaining, 0), 2147483647),
    );
    return () => clearTimeout(timer);
  }, [action.status, action.expiresAt, clock]);
  useEffect(() => {
    let active = true;
    void api
      .get('/agent/actions/' + initial.id)
      .then((r) => {
        if (active)
          setAction((current) =>
            current.id === initial.id && current.version <= r.data.data.version
              ? r.data.data
              : current,
          );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [initial]);
  useEffect(() => {
    if (action.status !== 'EXECUTING') return;
    const timer = setInterval(() => {
      void api
        .get('/agent/actions/' + action.id)
        .then((r) => setAction(r.data.data))
        .catch(() => setError('状态暂不可用，请稍后重新打开会话'));
    }, 2500);
    return () => clearInterval(timer);
  }, [action.id, action.status]);
  async function decide(decision: 'APPROVE' | 'REJECT') {
    if (busy) return;
    if (
      action.status === 'WAITING_CONFIRMATION' &&
      new Date(action.expiresAt).getTime() <= Date.now()
    ) {
      setClock(Date.now());
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(
        '/agent/actions/' + action.id + '/confirm',
        { decision, expectedVersion: action.version, expectedHash: action.payloadHash },
        { timeout: 60000 },
      );
      setAction(data.data);
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
      void api
        .get('/agent/actions/' + action.id)
        .then((r) => setAction(r.data.data))
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  const quote = action.payload.quote;
  return (
    <div className="my-4 rounded-2xl border border-orange-200 bg-orange-50/50 p-5 text-sm dark:border-orange-900">
      <div className="flex justify-between gap-3 font-semibold">
        <span>{labels[action.kind]}</span>
        <span className="text-xs text-ink-muted">
          {expired
            ? '确认已过期'
            : ['BATCH_CREATE_ORDERS', 'BATCH_OPERATIONS'].includes(action.kind) &&
                action.status === 'SUCCEEDED'
              ? action.result?.failed
                ? '批次处理完成，存在失败项'
                : '批次处理完成'
              : statuses[action.status] || action.status}
        </span>
      </div>
      {action.payload.batchOperations ? (
        <AgentBatchOperations
          batch={action.payload.batchOperations}
          result={action.result?.rows ? (action.result as BatchOperationOutcome) : undefined}
          labels={labels}
        />
      ) : action.payload.batch ? (
        <AgentBatchOrders
          batch={action.payload.batch}
          result={action.result?.rows ? (action.result as BatchOutcome) : undefined}
        />
      ) : action.payload.fields ? (
        <div className="my-3 space-y-2">
          <p>对象：{action.payload.summary?.name}</p>
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th>字段</th>
                <th>原值</th>
                <th>目标值</th>
              </tr>
            </thead>
            <tbody>
              {action.payload.fields.map((f) => (
                <tr key={f.label}>
                  <td className="py-2">{f.label}</td>
                  <td>
                    {typeof f.before === 'boolean'
                      ? f.before
                        ? '启用'
                        : '停用'
                      : String(f.before)}
                  </td>
                  <td className="font-medium">
                    {typeof f.after === 'boolean' ? (f.after ? '启用' : '停用') : String(f.after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-ink-muted">
            确认只授权上述字段变更。结果未知时请核对原管理页面。
          </p>
        </div>
      ) : ['PRODUCT_CREATE', 'PRODUCT_RENAME', 'PRODUCT_EDIT'].includes(action.kind) &&
        action.payload.input ? (
        <div className="my-3 space-y-2">
          <p>商品名称：{action.payload.input.name}</p>
          {action.payload.before && <p>原名称：{action.payload.before.name}</p>}
          {action.kind === 'PRODUCT_CREATE' && (
            <>
              <p>
                商品编号：{action.payload.input.code} · 分类编号：{action.payload.input.categoryId}
              </p>
              <p>
                售价 ¥{action.payload.input.price} · 成本 ¥{action.payload.input.costPrice}
              </p>
            </>
          )}
          <p className="text-xs text-ink-muted">结果未知时需到商品管理核对，不会自动重复提交。</p>
        </div>
      ) : action.payload.summary &&
        ['COUPON_TEMPLATE_CREATE', 'COUPON_ISSUE', 'SECKILL_TOGGLE'].includes(action.kind) ? (
        <div className="my-3 space-y-2">
          <p>名称：{action.payload.summary.name || action.payload.summary.templateName}</p>
          {action.kind === 'SECKILL_TOGGLE' ? (
            <p>
              目标状态：{action.payload.summary.enabled ? '启用' : '停用'} · 剩余名额{' '}
              {action.payload.summary.remainingStock}；已创建订单仍按原期限处理。
            </p>
          ) : (
            <>
              <p>
                满 ¥{action.payload.summary.minimumSpend} 减 ¥
                {action.payload.summary.discountAmount}
              </p>
              <p>
                {new Date(action.payload.summary.startsAt!).toLocaleString('zh-CN')} 至{' '}
                {new Date(action.payload.summary.endsAt!).toLocaleString('zh-CN')}
              </p>
              {action.payload.summary.recipients ? (
                <>
                  <p>发放对象：{action.payload.summary.count} 位会员</p>
                  <ul className="max-h-40 overflow-auto">
                    {action.payload.summary.recipients.map((m) => (
                      <li key={m.id} className="flex items-center gap-2">
                        <MemberAvatar compact name={m.name} />
                        {m.name} · {m.maskedPhone}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>仅创建模板，不自动向会员发券。</p>
              )}
            </>
          )}
        </div>
      ) : ['CREATE_MEMBER', 'RENAME_MEMBER', 'EDIT_MEMBER'].includes(action.kind) &&
        action.payload.input ? (
        <div className="my-3 space-y-2">
          <p>手机号：{action.payload.input.maskedPhone || action.payload.before?.maskedPhone}</p>
          {action.payload.before && <p>原姓名：{action.payload.before.name}</p>}
          <p>
            {action.payload.before ? '新姓名' : '姓名'}：
            <strong>{action.payload.input.name}</strong>
          </p>
          <p className="text-xs text-ink-muted">仅处理以上资料，不修改积分、等级或累计消费。</p>
        </div>
      ) : action.kind === 'CREATE_SECKILL' && action.payload.input ? (
        <div className="my-3 space-y-2">
          <p>
            活动：{action.payload.input.name} · 商品：
            {action.payload.summary?.productName || action.payload.input.productId}
          </p>
          <p>
            秒杀价 ¥{action.payload.input.price} · 独立名额 {action.payload.input.stock} ·
            每会员限一件
          </p>
          <p>开始：{new Date(action.payload.input.startsAt!).toLocaleString('zh-CN')}</p>
          <p>结束：{new Date(action.payload.input.endsAt!).toLocaleString('zh-CN')}</p>
          <p>待支付占用：{action.payload.input.holdMinutes}分钟。确认后发布启用活动。</p>
        </div>
      ) : quote ? (
        <>
          <p className="my-3 flex items-center gap-2">
            <MemberAvatar compact name={action.payload.member?.name || quote.memberName} />
            会员：{action.payload.member?.name || quote.memberName}{' '}
            {action.payload.member?.maskedPhone} · 门店：{quote.storeName}
          </p>
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th>商品</th>
                <th>数量</th>
                <th>原价小计</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((i, n) => (
                <tr key={n}>
                  <td className="py-2">{i.productName}</td>
                  <td>{i.quantity}</td>
                  <td>¥{i.subtotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3">
            原价 ¥{quote.originalAmount} · 优惠 ¥{quote.discountAmount} ·{' '}
            <strong>应付 ¥{quote.payableAmount}</strong>
          </p>
        </>
      ) : (
        <p className="my-3">
          订单 {action.payload.order?.orderNo} · 当前状态 {action.payload.order?.status} · 金额 ¥
          {action.kind === 'REFUND'
            ? action.payload.order?.paidAmount
            : action.payload.order?.payableAmount}
        </p>
      )}
      {action.kind === 'USER_CREATE' && (
        <p className="my-2 text-xs text-ink-muted">
          初始密码由服务器随机生成，不进入模型；创建后请在用户管理页设置密码再登录。
        </p>
      )}
      {action.kind === 'COUPON_TEMPLATE_UPDATE' && (
        <p className="my-2 text-xs text-ink-muted">
          发布替代新版本并停止旧模板后续发放；已发券保留原规则，不自动发新券。
        </p>
      )}
      {action.kind === 'COUPON_TEMPLATE_DISABLE' && (
        <p className="my-2 text-xs text-ink-muted">只停止后续发券，不删除已发会员券或历史记录。</p>
      )}
      {action.kind === 'COUPON_VOID' && (
        <p className="my-2 text-xs text-ink-muted">
          仅作废上述持有人的指定券，不影响其他会员或其他券。
        </p>
      )}
      {action.kind === 'PRODUCT_EDIT' && (
        <p className="my-2 text-xs text-ink-muted">
          调价影响后续报价，已有订单保留原快照；下架后不能再按普通商品新建订单。
        </p>
      )}
      {action.kind === 'EDIT_MEMBER' && (
        <p className="my-2 text-xs text-ink-muted">
          停用会员后不能新建订单；手机号仅展示脱敏值，历史订单与积分保持原业务规则。
        </p>
      )}
      {action.payload.reason && <p>退款原因：{action.payload.reason}</p>}
      {action.kind === 'CREATE_SECKILL' && action.payload.proposal && (
        <SeckillProposalEditor
          key={action.id}
          action={action}
          disabled={busy || disabled}
          onEditing={setEditing}
          onReplaced={(next) => {
            setAction(next);
            onReplaced?.(next);
            onChanged?.();
          }}
        />
      )}
      {action.kind === 'BENEFIT_POLICY' && (
        <p className="my-2 text-xs text-ink-muted">
          影响全平台后续会员报价；已有订单保留权益快照。折扣按万分比展示：9500表示95折。
        </p>
      )}
      {action.kind === 'MEMBER_TIER' && (
        <p className="my-2 text-xs text-ink-muted">
          仅改变手动等级设置；不增加积分或累计消费，后续报价按当前权益规则执行。
        </p>
      )}
      {action.kind === 'IMPORT_CONFIRM' && (
        <p className="my-2 text-xs text-ink-muted">
          将原文件校验通过的记录写入历史订单，不触发真实支付；请核对文件名称和行数。
        </p>
      )}
      <p className="my-3 text-xs leading-6 text-ink-muted">
        {action.payload.batchOperations
          ? '确认仅授权以上列出的固定操作，逐项结果以实际业务记录为准。'
          : action.payload.fields
          ? '确认仅授权上述字段变更。'
          : ['PRODUCT_CREATE', 'PRODUCT_RENAME', 'PRODUCT_EDIT'].includes(action.kind)
            ? '确认仅授权上述商品字段变更。'
            : action.kind === 'PAYMENT' || action.kind === 'REFUND'
              ? 'MOCK本地模拟，仅发起请求，不代表成功；结果演示需在订单详情人工操作。'
              : ['COUPON_TEMPLATE_CREATE', 'COUPON_ISSUE', 'SECKILL_TOGGLE'].includes(action.kind)
                ? '确认仅授权上述营销操作，创建模板不自动发券。'
                : ['CREATE_MEMBER', 'RENAME_MEMBER', 'EDIT_MEMBER'].includes(action.kind)
                  ? '确认仅授权上述会员资料变更。'
                  : action.kind === 'CREATE_SECKILL'
                    ? '确认发布上述秒杀活动，商品和价格由原业务服务复核。'
                    : '确认仅授权上述内容。创建订单后仍待支付；取消只适用于待支付后台单。'}{' '}
        新提问或修改将使未确认卡失效。有效期至{' '}
        {new Date(action.expiresAt).toLocaleTimeString('zh-CN')}。停止生成不代表撤销交易。
      </p>
      {expired && (
        <p role="status" className="mt-3 text-ink-muted">
          确认已过期，请重新提问并生成新的预览；订单请重新报价。
        </p>
      )}
      {action.status === 'WAITING_CONFIRMATION' && !expired && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || disabled || editing}
            onClick={() => void decide('APPROVE')}
          >
            {action.payload.batchOperations
              ? `确认执行以上 ${action.payload.batchOperations.rows.length} 项操作`
              : action.payload.batch
                ? `确认创建以上 ${action.payload.batch.rows.length} 笔待支付订单`
                : '确认执行'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || disabled}
            onClick={() => void decide('REJECT')}
          >
            拒绝
          </Button>
        </div>
      )}
      {['UNKNOWN', 'EXECUTING'].includes(action.status) && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || disabled}
          onClick={() => void decide('APPROVE')}
        >
          核对并恢复同一次操作
        </Button>
      )}
      {action.result &&
        !action.result.failure &&
        !action.payload.batch &&
        !action.payload.batchOperations && (
          <div className="mt-3">
            <p>
              结果状态：{action.result.status} {action.result.orderNo}{' '}
              {action.result.attempt ? '· 尝试号 ' + action.result.attempt : ''}
              {action.result.count ? ` · 已发放 ${action.result.count} 张券` : ''}
            </p>
            {(action.result.id || action.result.batchId) && (
              <p className="my-1 break-all text-xs text-ink-muted">
                结果编号：{action.result.id || action.result.batchId}
              </p>
            )}
            <Link
              className="text-orange-800 underline"
              href={
                action.kind.startsWith('ROLE_')
                  ? '/system/roles'
                  : action.kind.startsWith('USER_')
                    ? '/system/users'
                    : action.kind.startsWith('CATEGORY_')
                      ? '/products'
                      : action.kind.startsWith('REGION_') || action.kind.startsWith('STORE_')
                        ? '/stores'
                        : ['PRODUCT_CREATE', 'PRODUCT_RENAME', 'PRODUCT_EDIT'].includes(action.kind)
                          ? '/products'
                          : action.kind === 'IMPORT_CONFIRM'
                            ? '/data-imports/history'
                            : action.kind === 'METRIC_STATUS'
                              ? '/metrics'
                              : ['BENEFIT_POLICY', 'MEMBER_TIER'].includes(action.kind)
                                ? '/members'
                                : action.kind.startsWith('COUPON_')
                                  ? '/members'
                                  : action.kind === 'SECKILL_TOGGLE'
                                    ? '/seckill'
                                    : ['CREATE_MEMBER', 'RENAME_MEMBER', 'EDIT_MEMBER'].includes(
                                          action.kind,
                                        )
                                      ? '/members'
                                      : action.kind === 'CREATE_SECKILL'
                                        ? '/seckill'
                                        : '/orders'
              }
            >
              {action.payload.fields
                ? '前往对应管理页面查看'
                : ['PRODUCT_CREATE', 'PRODUCT_RENAME', 'PRODUCT_EDIT'].includes(action.kind)
                  ? '前往商品管理查看'
                  : [
                        'CREATE_MEMBER',
                        'RENAME_MEMBER',
                        'COUPON_TEMPLATE_CREATE',
                        'COUPON_ISSUE',
                      ].includes(action.kind)
                    ? '前往会员管理查看'
                    : ['CREATE_SECKILL', 'SECKILL_TOGGLE'].includes(action.kind)
                      ? '前往秒杀活动查看'
                      : '前往订单中心查看'}
            </Link>
          </div>
        )}
      {(error || (action.status === 'FAILED' && action.result?.failure?.message)) && (
        <p role="alert" className="mt-3 text-brick">
          {error || action.result?.failure?.message}
        </p>
      )}
    </div>
  );
}
