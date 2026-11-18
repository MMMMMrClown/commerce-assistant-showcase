'use client';
import { useEffect } from 'react';
import { Sparkles, LoaderCircle, RefreshCw, ChevronRight } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { Button } from './ui';
type Trace = {
  sequence: number;
  toolName: string;
  status: string;
  durationMs: number;
  argumentFields: string[];
  sources?: { section: string; ruleVersion: string; sourcePath: string }[];
};
type Detail = {
  evidence?: unknown[];
  status: string;
  createdAt?: string;
  updatedAt?: string;
  events?: {
    id: string;
    at: string;
    title: string;
    detail: string;
    technologies: string[];
    status: string;
  }[];
  trace: Trace[];
  actions: {
    id: string;
    kind: string;
    status: string;
    workflow?: { phase: string; nextNodes: string[] };
  }[];
  mcp?: { note: string };
};
export function AgentTrace({ runId, live }: { runId: string; live: boolean }) {
  const result = useApi<Detail>('/agent/runs/' + runId + '/trace'),
    { reload } = result;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [live, reload]);
  useEffect(() => {
    if (!live) void reload();
  }, [live, reload]);
  const data = result.error ? null : result.data;
  const status = live
    ? '正在处理'
    : data?.status === 'WAITING_CONFIRMATION'
      ? '方案已生成，等待确认'
      : data?.status === 'FAILED'
        ? '本轮执行中断'
        : '本轮处理完成';
  return (
    <details className="group/execution my-3 text-sm text-stone-500 dark:text-stone-400">
      <summary className="cursor-pointer list-none select-none py-2">
        <span className="inline-flex items-center gap-2">
          {live ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}
          执行过程 · {status}
          <span className="text-[11px] text-stone-400">仅管理员可见</span>
          <ChevronRight size={13} className="transition-transform group-open/execution:rotate-90" />
          <span className="text-[11px] group-open/execution:hidden">展开</span>
          <span className="hidden text-[11px] group-open/execution:inline">收起</span>
        </span>
      </summary>
      {result.error ? (
        <p role="alert" className="py-3 text-red-600">
          无法读取执行记录，请检查当前权限或稍后刷新。
        </p>
      ) : (
        <div className="py-2 pl-1">
          <div className="space-y-5 leading-7">
            {data?.events?.length ? (
              data.events.map((e) => (
                <div key={e.id}>
                  <p className="font-medium text-stone-600 dark:text-stone-300">
                    {e.title}
                    <span className="ml-3 text-[10px] font-normal text-stone-400">
                      {new Date(e.at).toLocaleTimeString('zh-CN')}
                    </span>
                  </p>
                  <p className="text-[13px]">{e.detail}</p>
                  <p className="mt-1 text-[11px] text-stone-400">{e.technologies.join(' · ')}</p>
                </div>
              ))
            ) : data?.trace.length ? (
              data.trace.map((t) => (
                <div key={t.sequence}>
                  <p>
                    调用 {t.toolName}，
                    {t.status === 'SUCCEEDED' ? '已取得业务结果' : '未完成，需核对原因'}。
                  </p>
                  <p className="text-xs">历史工具记录；本轮没有保存完整阶段事件。</p>
                </div>
              ))
            ) : (
              <p>
                {live ? '已接收请求，正在等待执行事件…' : '此记录尚无阶段事件，可能是旧版任务。'}
              </p>
            )}
          </div>
          <div className="mt-5 flex items-center justify-between text-[11px]">
            <span>依据真实运行事件整理</span>
            <Button size="sm" variant="ghost" onClick={() => void reload()}>
              <RefreshCw size={12} />
              刷新
            </Button>
          </div>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer">技术调用明细</summary>
            <div className="space-y-3 py-3">
              {data?.trace.map((t) => (
                <div key={t.sequence}>
                  <p>
                    #{t.sequence} {t.toolName} · <span>{t.durationMs} ms</span>
                  </p>
                  <p>输入字段：{t.argumentFields.join('、') || '无参数'}</p>
                  {t.sources?.map((s, i) => (
                    <p key={i}>
                      规则来源：{s.section} · {s.ruleVersion}
                      <br />
                      {s.sourcePath}
                    </p>
                  ))}
                </div>
              ))}
              {data?.actions.map((a) => (
                <p key={a.id}>
                  {a.kind} · {a.status}
                  <br />
                  {a.workflow &&
                    'LangGraph：' +
                      a.workflow.phase +
                      ' · ' +
                      (a.workflow.nextNodes.join(' / ') || '已结束')}
                </p>
              ))}
              {data?.mcp && <p>{data.mcp.note}</p>}
              {!!data?.evidence?.length && (
                <details>
                  <summary className="cursor-pointer">原始工具结果（JSON）</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(data.evidence, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </details>
        </div>
      )}
    </details>
  );
}
