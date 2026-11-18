'use client';
import { MemberAvatar } from '@/components/member-avatar';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/use-api';
import { api, errorMessage, type PageResult } from '@/lib/api';
import type { CouponTemplate } from '@/lib/coupons';
import { useAppSelector } from '@/store/store';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  Table,
  Th,
  Td,
} from '@/components/ui';
export type Program = {
  kind: string;
  enabled: boolean;
  templateId: string | null;
  version: number;
  template: { name: string; startsAt: string; endsAt: string; deletedAt: string | null } | null;
};
type Grant = {
  id: string;
  member: { name: string; avatarUrl?: string | null };
  memberId: string;
  period: string;
  status: string;
  attempts: number;
  couponId: string | null;
  templateId: string;
  originalTemplateId: string;
  lastError: string | null;
  createdAt: string;
};
const programNames: Record<string, string> = { BIRTHDAY: '生日关怀', WELCOME: '新会员礼包' };
const rules: Record<string, string> = {
  BIRTHDAY:
    '上海日期生日当天发券；非闰年2月29日按2月28日。同一会员每自然年一次，生日每自然年最多修改一次（首次填写计一次）。停服未记录的历史生日不追发；已入队资格可补发。',
  WELCOME:
    '仅在玩法启用期间新增的启用会员获得资格，每人一次；编辑、重新启用及旧会员均不触发。已入队资格在任务重启后恢复，停用期间暂停发放。',
};
const statuses: Record<string, string> = { PENDING: '待发放', FAILED: '失败', SUCCEEDED: '已发放' };
export default function MemberMarketing({ kind }: { kind: 'BIRTHDAY' | 'WELCOME' }) {
  const programs = useApi<Program[]>('/marketing/programs');
  const p = programs.data?.find((p) => p.kind === kind);
  const [page, setPage] = useState(1),
    [status, setStatus] = useState('');
  const grants = useApi<PageResult<Grant>>(
    '/marketing/programs/' +
      kind +
      '/grants?' +
      new URLSearchParams({ page: String(page), status }),
  );
  const permissions = useAppSelector((s) => s.auth.user?.permissions || []);
  const canManage = ['member:view', 'member:benefits-manage', 'member:coupon-issue'].every((code) =>
    permissions.includes(code),
  );
  const [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState<Grant | 'RUN' | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function execute() {
    if (lock.current || !confirm) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.post(
        confirm === 'RUN'
          ? '/marketing/programs/' + kind + '/run'
          : '/marketing/grants/' + confirm.id + '/retry',
      );
      const data = result.data.data as {
        status?: string;
        lastError?: string;
        processed?: number;
        succeeded?: number;
        busy?: boolean;
      };
      setMessage(
        data.status === 'FAILED'
          ? '补发失败：' + data.lastError
          : data.status === 'SUCCEEDED'
            ? '已发放，重复请求不会重复给券'
            : data.busy
              ? '后台任务正在运行，请稍后刷新'
              : '本次处理 ' + (data.processed || 0) + ' 条，成功 ' + (data.succeeded || 0) + ' 条',
      );
      setConfirm(null);
      await grants.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title={programNames[kind]}
        description="复用原优惠券模板与券生命周期；后台每30秒扫描，失败需管理员核对补发。"
      />
      <Card className="mb-5 space-y-3 p-5">
        <p className="text-sm leading-6">{rules[kind]}</p>
        {programs.loading ? (
          <LoadingState />
        ) : programs.error ? (
          <ErrorState message={programs.error} retry={programs.reload} />
        ) : (
          p && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={p.enabled ? 'green' : 'neutral'}>
                  {p.enabled ? '已启用' : '已关闭'}
                </Badge>
                <span>
                  赠送模板：{p.template?.name || '未配置'} · 配置 V{p.version}
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                资格入队时冻结模板；模板停发或过期会产生失败记录。补发明确采用当前配置模板，成功后不重复发券。
              </p>
              {canManage && (
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    配置玩法
                  </Button>
                  <Button
                    disabled={!p.enabled}
                    onClick={() => {
                      setConfirm('RUN');
                      setError('');
                    }}
                  >
                    立即扫描并发放
                  </Button>
                </div>
              )}
            </>
          )
        )}
        {!canManage && (
          <p className="text-xs text-ink-muted">配置与发放需会员权益管理和发券权限。</p>
        )}
      </Card>
      {message && (
        <p role="status" className="mb-4">
          {message}
        </p>
      )}
      {error && !confirm && <p role="alert">{error}</p>}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="font-semibold">权益发放记录</h2>
          <Select
            aria-label="发放状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            {Object.entries(statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => void grants.reload()}>
            刷新记录
          </Button>
        </div>
        {grants.loading ? (
          <LoadingState />
        ) : grants.error ? (
          <ErrorState message={grants.error} retry={grants.reload} />
        ) : (
          grants.data && (
            <>
              {grants.data.items.length ? (
                <Table>
                  <thead>
                    <tr>
                      {[
                        '会员 / 周期',
                        '状态 / 尝试次数',
                        '模板 / 券编号',
                        '失败说明',
                        '资格记录时间',
                        '操作',
                      ].map((t) => (
                        <Th key={t}>{t}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grants.data.items.map((g) => (
                      <tr key={g.id}>
                        <Td>
                          <div className="flex items-center gap-2">
                            <MemberAvatar compact name={g.member.name} src={g.member.avatarUrl} />
                            <span>{g.member.name}</span>
                          </div>
                          <p className="text-xs">
                            {g.period === 'ONCE' ? '一次性礼包' : g.period + '年度'}
                          </p>
                        </Td>
                        <Td>
                          {statuses[g.status]} / {g.attempts}
                        </Td>
                        <Td>
                          <p className="text-xs">{g.templateId}</p>
                          <p className="text-xs">{g.couponId || '尚未产生券'}</p>
                          {g.originalTemplateId !== g.templateId && (
                            <p className="text-xs">原模板：{g.originalTemplateId}</p>
                          )}
                        </Td>
                        <Td>{g.lastError || '—'}</Td>
                        <Td>{new Date(g.createdAt).toLocaleString('zh-CN')}</Td>
                        <Td>
                          {g.status === 'FAILED' && canManage && (
                            <Button
                              size="sm"
                              disabled={!p?.enabled}
                              onClick={() => {
                                setConfirm(g);
                                setError('');
                              }}
                            >
                              按当前配置补发
                            </Button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState />
              )}
              <Pagination
                page={page}
                pageSize={20}
                total={grants.data.total}
                onPageChange={setPage}
              />
            </>
          )
        )}
      </Card>
      {editing && p && (
        <ProgramEditor
          key={p.version}
          program={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void programs.reload();
          }}
        />
      )}
      <Dialog
        open={!!confirm}
        onOpenChange={(v) => {
          if (!v && !busy) setConfirm(null);
        }}
        title={confirm === 'RUN' ? '确认扫描发放' : '确认补发权益'}
      >
        <p>
          {confirm === 'RUN'
            ? '仅处理当前玩法符合规则的待发资格，不重复发放已成功记录。'
            : '给该失败记录对应的会员补发当前配置模板：' +
              (p?.template?.name || '未配置') +
              '。原失败记录保留，成功后不会再次发券。'}
        </p>
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy} onClick={() => void execute()}>
          {busy ? '处理中…' : '确认执行'}
        </Button>
      </Dialog>
    </>
  );
}
function ProgramEditor({
  program,
  onClose,
  onSaved,
}: {
  program: Program;
  onClose: () => void;
  onSaved: () => void;
}) {
  const templates = useApi<CouponTemplate[]>('/coupons/templates');
  const [templateId, setTemplateId] = useState(program.templateId || ''),
    [enabled, setEnabled] = useState(program.enabled),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.patch('/marketing/programs/' + program.kind, {
        enabled,
        templateId: templateId || null,
        version: program.version,
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title={'配置' + programNames[program.kind]}
    >
      <div className="space-y-4">
        <p className="text-sm">{rules[program.kind]}</p>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          启用自动发放
        </label>
        {templates.loading ? (
          <LoadingState />
        ) : templates.error ? (
          <ErrorState message={templates.error} retry={templates.reload} />
        ) : (
          <label className="block">
            赠送优惠券模板
            <Select
              className="mt-2 w-full"
              value={templateId}
              disabled={busy}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">请选择当前有效模板</option>
              {program.templateId && !templates.data?.some((t) => t.id === program.templateId) && (
                <option value={program.templateId}>原模板已停发（请更换）</option>
              )}
              {templates.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · 满{t.minimumSpend}减{t.discountAmount} · V{t.version}
                </option>
              ))}
            </Select>
          </label>
        )}
        <p className="text-xs text-ink-muted">
          保存启用后开始自动处理；停用不作废已发出的券。券仍遵守原有效期和交易占用规则。
        </p>
        {error && <p role="alert">{error}</p>}
        <Button
          disabled={busy || templates.loading || !!templates.error}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '确认保存配置'}
        </Button>
      </div>
    </Dialog>
  );
}
export function MarketingBenefits() {
  const result = useApi<Program[]>('/marketing/programs');
  return (
    <Card className="my-5 space-y-3 p-5">
      <h2 className="font-semibold">营销权益</h2>
      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState message={result.error} retry={result.reload} />
      ) : (
        result.data?.map((p) => (
          <div key={p.kind} className="border-t border-line pt-3">
            <Link href={p.kind === 'BIRTHDAY' ? '/marketing/birthday' : '/marketing/welcome'}>
              {programNames[p.kind]} · {p.enabled ? '已启用' : '已关闭'} →
            </Link>
            <p className="text-xs leading-6 text-ink-muted">{rules[p.kind]}</p>
            <p className="text-xs">
              赠送：{p.template?.name || '未配置'}；配置与记录统一在营销页面维护。
            </p>
          </div>
        ))
      )}
    </Card>
  );
}
