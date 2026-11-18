'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, ListChecks } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { api, errorMessage } from '@/lib/api';
import { Button } from './ui';
import type { AgentAction } from './agent-action';
type Plan = {
  id: string;
  title: string;
  status: string;
  missingFields: string[];
  failure?: string;
  steps: { key: string; title: string; status: string; resourceId?: string }[];
};
const statusLabels: Record<string, string> = {
  NEEDS_INPUT: '待补充信息',
  READY: '可以准备下一步',
  WAITING_CONFIRMATION: '等待本步骤确认',
  PARTIAL_COMPLETED: '部分完成',
  CHECK_RESULT: '先核对执行结果',
  SUCCEEDED: '全部步骤已完成',
  CANCELED: '剩余步骤已停止',
};
export function AgentTaskPlan({
  conversationId,
  refreshKey,
  disabled,
  onAction,
  onChanged,
  onPrompt,
  resource = 'task-plan',
}: {
  conversationId: string;
  refreshKey: number;
  disabled: boolean;
  onAction: (a: AgentAction) => void;
  onChanged: () => void;
  onPrompt: (text: string) => void;
  resource?: 'task-plan' | 'operation-plan';
}) {
  const result = useApi<Plan | null>('/agent/conversations/' + conversationId + '/' + resource);
  const { reload } = result;
  const previous = useRef(refreshKey),
    working = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (previous.current !== refreshKey) {
      previous.current = refreshKey;
      void reload();
    }
  }, [refreshKey, reload]);
  async function change(action: 'resume' | 'cancel') {
    if (working.current || disabled) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await api.post(
        '/agent/conversations/' + conversationId + '/' + resource + '/' + action,
      );
      if (response.data.data.action) onAction(response.data.data.action);
      else if (response.data.data.nextPrompt) onPrompt(response.data.data.nextPrompt);
      onChanged();
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  if (!result.data)
    return result.error ? <p role="alert">任务状态加载失败：{result.error}</p> : null;
  const plan = result.data,
    finished = ['SUCCEEDED', 'CANCELED'].includes(plan.status);
  return (
    <section
      aria-label="多步骤业务任务"
      className="my-5 rounded-2xl border border-orange-200 bg-orange-50/40 p-5 dark:border-orange-900 dark:bg-orange-950/20"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks size={17} />
          {plan.title}
        </h2>
        <span className="text-xs text-orange-800 dark:text-orange-200">
          {statusLabels[plan.status] || plan.status}
        </span>
      </div>
      <ol className="my-4 space-y-3">
        {plan.steps.map((step, i) => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            {step.status === 'SUCCEEDED' ? (
              <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" />
            ) : (
              <Circle size={17} className="mt-0.5 shrink-0 text-stone-400" />
            )}
            <div>
              {i + 1}. {step.title}
              <p className="mt-1 text-xs text-stone-500">
                {step.status === 'SUCCEEDED'
                  ? '已完成，续接不会重复执行'
                  : step.status === 'WAITING_CONFIRMATION'
                    ? '请在下方操作卡确认'
                    : step.status === 'PENDING'
                      ? '尚未执行'
                      : '需重新准备或核对'}
              </p>
              {step.resourceId && (
                <p className="mt-1 break-all text-xs text-stone-500">
                  {resource === 'task-plan' ? '模板编号' : '结果编号'}：{step.resourceId}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!!plan.missingFields.length && !finished && (
        <p className="mb-3 text-sm text-stone-600 dark:text-stone-300">
          还需补充：{plan.missingFields.join('、')}
        </p>
      )}
      {plan.failure && !finished && (
        <p className="mb-3 text-sm text-orange-800 dark:text-orange-200">
          未完成原因：{plan.failure}。已完成步骤会保留。
        </p>
      )}
      {!finished && (
        <div className="flex flex-wrap gap-2">
          {plan.missingFields.length ? (
            <Button
              size="sm"
              disabled={busy || disabled}
              onClick={() =>
                onPrompt('继续当前满减发券任务，需要补充：' + plan.missingFields.join('、'))
              }
            >
              补充信息
            </Button>
          ) : (
            <Button size="sm" disabled={busy || disabled} onClick={() => void change('resume')}>
              {plan.status === 'WAITING_CONFIRMATION'
                ? '显示待确认操作'
                : plan.status === 'CHECK_RESULT'
                  ? '核对当前操作'
                  : resource === 'operation-plan'
                    ? '继续下一步'
                    : '准备下一步'}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || disabled || plan.status === 'CHECK_RESULT'}
            onClick={() => void change('cancel')}
          >
            停止剩余步骤
          </Button>
        </div>
      )}
      <p className="mt-3 text-xs leading-6 text-stone-500">
        {resource === 'task-plan'
          ? '每步分别预览、确认。创建模板不会自动发券；停止任务不撤销已完成的业务。'
          : '按顺序逐步查询、补问和确认。继续会填写下一步需求，发送后处理；停止任务不撤销已完成业务。'}
      </p>
      {(error || result.error) && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error || result.error}
        </p>
      )}
    </section>
  );
}
