'use client';
import { AgentTaskPlan } from '@/components/agent-task-plan';
import { AgentEvidence } from '@/components/agent-evidence';
import { AgentImportAttachment } from '@/components/agent-import-attachment';
import { AgentImageText } from '@/components/agent-image-text';
import { imageQuestionParts } from '@/lib/agent-image-text';
import { AgentComposer, type SentImage } from '@/components/agent-composer';
import { AgentTrace } from '@/components/agent-trace';
import { AgentActionCard, type AgentAction } from '@/components/agent-action';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MemberAvatar } from '@/components/member-avatar';
import { Plus, Trash2, Copy, RotateCcw } from 'lucide-react';
import { AgentAnswer } from '@/components/agent-answer';
import { Button, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { groupActionsByTurn } from '@/lib/agent-action-groups';
type Reply = {
  answer: string;
  requestId: string;
  mode: string;
  runId?: string;
  evidence?: Evidence[];
};
type Evidence = {
  name: string;
  queriedAt: string;
  scope?: string;
  result?: {
    candidates?: { id: string; name: string; maskedPhone: string; enabled: boolean }[];
    selectionRequired?: boolean;
    matchQuality?: 'SIMILAR_NAME';
    searchedName?: string;
    action?: AgentAction;
    [key: string]: unknown;
  };
};
type Turn = { question: string; reply: Reply; image?: SentImage };
type Session = { id: string; title: string; updatedAt: string };
const tools = [
  { name: 'query_sales_summary', title: '销售概览' },
  { name: 'query_member_statistics', title: '会员统计' },
  { name: 'query_campaign_performance', title: '活动概览' },
  { name: 'query_payment_summary', title: '支付退款' },
];
export default function AgentView({
  compact = false,
  initialConversationId = '',
  onSessionChange,
  onBusyChange,
}: {
  compact?: boolean;
  initialConversationId?: string;
  onSessionChange?: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
} = {}) {
  const agentStatus = useApi<{ traceEnabled: boolean }>('/agent/status');
  const capabilities =
    useApi<{ key: string; label: string; requiresApproval?: boolean; executionEnabled: boolean }[]>(
      '/agent/capabilities',
    );
  const availableTools = tools.filter((t) => capabilities.data?.some((c) => c.key === t.name));
  const operations = capabilities.data?.filter((c) => c.requiresApproval) || [];
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [runId, setRunId] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState('');
  const [entries, setEntries] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [composerVersion, setComposerVersion] = useState(0);
  const [toolNotice, setToolNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const request = useRef(0);
  const mountConversation = useRef(initialConversationId);
  const mountOpen = useRef(open);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const groupedActions = groupActionsByTurn(entries, actions);
  const renderedGeneration = request.current;
  useEffect(() => {
    if (selected) onSessionChange?.(selected);
  }, [selected, onSessionChange]);
  useEffect(() => {
    onBusyChange?.(busy || mediaBusy);
  }, [busy, mediaBusy, onBusyChange]);
  function refreshActions() {
    const generation = request.current;
    setTaskRefresh((n) => n + 1);
    if (selected)
      void api
        .get('/agent/conversations/' + selected)
        .then((r) => {
          if (generation === request.current) setActions(r.data.data.actions || []);
        })
        .catch(() => undefined);
  }
  function renderAction(action: AgentAction) {
    if (compact)
      return (
        <Link
          key={action.id}
          className="my-3 block rounded-lg border border-line p-3 text-sm text-brand"
          href={'/agent?conversationId=' + encodeURIComponent(selected)}
        >
          已准备业务草案，前往完整助手预览与确认 →
        </Link>
      );
    const generation = request.current;
    return (
      <AgentActionCard
        key={action.id}
        action={action}
        disabled={busy || mediaBusy}
        onReplaced={(next) => {
          if (generation === request.current)
            setActions((previous) => [
              next,
              ...previous.filter((a) => a.id !== action.id && a.id !== next.id),
            ]);
        }}
        onChanged={() => {
          if (generation === request.current) refreshActions();
        }}
      />
    );
  }
  async function refresh() {
    const { data } = await api.get('/agent/conversations');
    setSessions(data.data);
  }
  function disposeView() {
    mounted.current = false;
    request.current += 1;
    abort.current?.abort();
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => setError('会话列表加载失败'));
    const incoming =
      mountConversation.current ||
      new URLSearchParams(window.location.search).get('conversationId');
    if (incoming) void mountOpen.current(incoming);
    return disposeView;
  }, []);
  useEffect(() => {
    if (busy) bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [entries, busy]);
  async function open(id: string) {
    if (busy || mediaBusy) return;
    const token = ++request.current;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/agent/conversations/' + id);
      if (token !== request.current) return;
      setSelected(id);
      setRunId(data.data.lastRunId || '');
      setEntries(data.data.messages);
      setActions(data.data.actions || []);
      setTaskRefresh((n) => n + 1);
    } catch {
      setError('打开会话失败');
    } finally {
      if (token === request.current) setLoading(false);
    }
  }
  async function remove(id: string) {
    if (busy || mediaBusy || !window.confirm('删除这段会话及全部聊天记录？')) return;
    try {
      await api.delete('/agent/conversations/' + id);
      if (id === selected) {
        ++request.current;
        setSelected('');
        setEntries([]);
        setActions([]);
        setRunId('');
      }
      await refresh();
    } catch {
      setError('删除失败');
    }
  }
  async function ask(tool?: string, override?: string, image?: SentImage) {
    if (submitting.current || busy || loading) return;
    const question = tool
      ? tools.find((t) => t.name === tool)!.title
      : (override ?? message).trim();
    if (!question) return;
    const generation = ++request.current;
    setToolNotice('');
    submitting.current = true;
    setBusy(true);
    setRunId('');
    let sessionId = selected;
    if (!sessionId) {
      try {
        const { data } = await api.post('/agent/conversations');
        sessionId = data.data.id;
        setSelected(sessionId);
        await refresh();
      } catch {
        setError('创建会话失败');
        submitting.current = false;
        setBusy(false);
        return;
      }
    }
    if (!mounted.current || generation !== request.current) {
      submitting.current = false;
      return;
    }
    setBusy(true);
    setError('');
    const id = crypto.randomUUID();
    setEntries((previous) => [
      ...previous,
      {
        question,
        ...(image ? { image } : {}),
        reply: { answer: '', mode: tool ? 'direct' : 'model', requestId: id, evidence: [] },
      },
    ]);
    if (!tool) setMessage('');
    const update = (fn: (reply: Reply) => Reply) =>
      setEntries((previous) =>
        previous.map((entry) =>
          entry.reply.requestId === id ? { ...entry, reply: fn(entry.reply) } : entry,
        ),
      );
    let complete = false;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch('/api/v1/agent/chat/stream', {
        method: 'POST',
        signal: controller.signal,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: sessionId,
          message: question,
          days: Number(days),
          ...(tool ? { tool } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message || '查询失败');
      }
      if (!response.body) throw new Error('未收到响应流');
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      // 【流式展示】消费服务端SSE事件；每个真实模型delta立即追加，不做本地打字动画。
      const consume = (frame: string) => {
        const event = frame
          .split('\n')
          .find((l) => l.startsWith('event:'))
          ?.slice(6)
          .trim();
        const raw = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!raw) return;
        if (event === 'run') {
          const currentRun = (JSON.parse(raw) as { runId: string }).runId;
          setRunId(currentRun);
          update((reply) => ({ ...reply, runId: currentRun }));
        }
        if (event === 'tool_error') setToolNotice((JSON.parse(raw) as { message: string }).message);
        if (event === 'delta') {
          const data = JSON.parse(raw) as { text: string };
          update((reply) => ({ ...reply, answer: reply.answer + data.text }));
        }
        if (event === 'evidence') {
          const data = JSON.parse(raw) as Evidence;
          if (data.result?.plan) setTaskRefresh((n) => n + 1);
          if (data.result?.action)
            setActions((previous) => [
              data.result!.action!,
              ...previous.filter((a) => a.id !== data.result!.action!.id),
            ]);
          update((reply) => ({ ...reply, evidence: [...(reply.evidence || []), data] }));
        }
        if (event === 'done') {
          const data = JSON.parse(raw) as Reply;
          complete = true;
          update((previous) => ({ ...data, runId: data.runId || previous.runId, requestId: id }));
          void refresh();
        }
        if (event === 'error') throw new Error((JSON.parse(raw) as { message: string }).message);
      };
      try {
        while (true) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
          buffer = frames.pop() || '';
          for (const frame of frames) consume(frame);
          if (chunk.done) {
            if (buffer.trim()) consume(buffer);
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!complete) throw new Error('连接中断，回答未完成，请重试');
    } catch (err) {
      const text = controller.signal.aborted
        ? '已停止生成。停止不等于撤销已确认交易；请核对操作卡结果'
        : err instanceof Error
          ? err.message
          : '查询失败';
      setError(text);
      update((reply) => ({ ...reply, answer: reply.answer + '\n\n回答未完成：' + text }));
    } finally {
      submitting.current = false;
      setBusy(false);
      setTaskRefresh((n) => n + 1);
      void api
        .get('/agent/conversations/' + sessionId)
        .then((r) => {
          if (generation === request.current) setActions(r.data.data.actions || []);
        })
        .catch(() => undefined);
    }
  }

  return (
    <div
      className={
        compact
          ? 'flex h-full min-h-0 overflow-hidden bg-surface'
          : 'grid min-h-[calc(100vh-130px)] overflow-hidden rounded-[14px] border border-line bg-surface lg:grid-cols-[230px_1fr]'
      }
    >
      {!compact && (
        <aside className="border-b border-line bg-sunken p-3 dark:border-line dark:bg-surface lg:border-b-0 lg:border-r">
          <Button
            className="mb-5 w-full"
            disabled={busy || loading || mediaBusy}
            onClick={() => {
              ++request.current;
              setSelected('');
              setEntries([]);
              setActions([]);
              setRunId('');
              setMessage('');
              setComposerVersion((version) => version + 1);
              setError('');
            }}
          >
            <Plus size={16} />
            新建会话
          </Button>
          <p className="mb-2 px-2 text-xs text-ink-faint">最近的对话</p>
          <div className="max-h-[65vh] space-y-1 overflow-auto">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={
                  'flex items-center rounded-lg ' +
                  (selected === s.id
                    ? 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100'
                    : 'hover:bg-sunken dark:hover:bg-sunken')
                }
              >
                <button
                  disabled={busy || loading || mediaBusy}
                  onClick={() => void open(s.id)}
                  className="min-w-0 flex-1 truncate px-3 py-3 text-left text-sm"
                >
                  {s.title}
                </button>
                <button
                  disabled={busy || mediaBusy}
                  onClick={() => void remove(s.id)}
                  aria-label={'删除会话：' + s.title}
                  className="mr-1 rounded p-2 text-ink-faint hover:text-brick"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!sessions.length && (
              <p className="px-2 py-4 text-xs text-ink-faint">对话记录会保存在这里</p>
            )}
          </div>
        </aside>
      )}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-4 dark:border-line">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-100 text-orange-800">
              <Image
                loading="eager"
                src="/brand/agent-mascot.png"
                alt="拾光经营助手"
                width={36}
                height={36}
                className="brand-agent-avatar h-9 w-9"
              />
            </span>
            <div>
              <h1 className="font-semibold">拾光 · 运营助手</h1>
              <p className="text-xs text-ink-faint">你的零售经营伙伴</p>
            </div>
          </div>
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="默认查询范围">
            <option value="7">近7天</option>
            <option value="30">近30天</option>
            <option value="90">近90天</option>
          </Select>
        </header>
        <div
          className={
            compact
              ? 'min-h-0 flex-1 overflow-y-auto px-4 py-3'
              : 'max-h-[calc(100vh-330px)] min-h-80 flex-1 overflow-y-auto px-5 py-6 sm:px-10'
          }
        >
          {loading ? (
            <p className="text-sm text-ink-faint">正在读取会话…</p>
          ) : !entries.length ? (
            <div
              className={
                compact ? 'mx-auto py-3 text-center' : 'mx-auto max-w-2xl py-14 text-center'
              }
            >
              <div className="mb-5 flex flex-wrap justify-center gap-2">
                {availableTools.map((t) => (
                  <button
                    key={t.name}
                    disabled={busy || mediaBusy}
                    onClick={() => void ask(t.name)}
                    className="rounded-lg border px-3 py-2 text-xs"
                  >
                    直接查询 · {t.title}
                  </button>
                ))}
              </div>
              <Image
                loading="eager"
                src="/brand/agent-thinking-cardigan.png"
                alt="穿着针织衫的拾光拿着笔记本，陪你思考经营问题"
                width={128}
                height={128}
                className={
                  compact
                    ? 'brand-agent-avatar mx-auto mb-3 h-20 w-20'
                    : 'brand-agent-avatar mx-auto mb-4 h-32 w-32'
                }
              />
              <h2 className={compact ? 'text-lg font-semibold' : 'text-2xl font-semibold'}>
                {compact ? '想查点什么？' : '今天，想了解哪些经营情况？'}
              </h2>
              <p className="mt-3 text-sm text-ink-muted">
                {compact
                  ? '查经营、查会员、解释业务规则。'
                  : '查经营、查会员、解释业务规则，也能帮你准备订单和秒杀活动。'}
              </p>
              <p className={compact ? 'hidden' : 'mt-3 text-xs leading-6 text-ink-muted'}>
                {operations.length
                  ? '可准备：' +
                    operations
                      .slice(0, 6)
                      .map((c) => c.label)
                      .join('、') +
                    (operations.length > 6 ? `等${operations.length}项操作` : '') +
                    '。先预览，再由你确认。'
                  : capabilities.loading
                    ? '正在加载可用能力…'
                    : '当前账号以已授权查询为主。'}
                {operations.some((c) => !c.executionEnabled) && ' 当前写开关关闭，只可预览。'}
                发送“你能做什么”查看详情。
              </p>
              <div className={compact ? 'hidden' : 'mt-8 grid gap-3 text-sm sm:grid-cols-2'}>
                {[
                  '分析近30天经营情况，给出未来两周的行动建议和验证指标',
                  '帮我新增一位会员，再为他创建订单，先告诉我还缺哪些信息',
                  '查看会员权益规则，我想调整其中一个等级的折扣',
                  '帮我看看支付与退款情况',
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setMessage(q)}
                    className="brand-agent-prompt rounded-xl border border-line p-4 text-left hover:border-orange-300 dark:border-line"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-8">
              {entries.map((entry, i) => (
                <div key={entry.reply.requestId}>
                  <div className="mb-6 flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-sunken px-5 py-3 text-sm leading-7 dark:bg-sunken">
                      {entry.image ? (
                        <>
                          <Image
                            unoptimized
                            src={entry.image.url}
                            width={240}
                            height={180}
                            alt="已发送图片"
                            className="mb-2 max-h-48 w-auto max-w-full rounded-xl object-contain"
                          />
                          {entry.image.prompt && <p>{entry.image.prompt}</p>}
                        </>
                      ) : (
                        imageQuestionParts(entry.question)?.prompt || entry.question
                      )}
                      <AgentImageText
                        question={entry.question}
                        disabled={busy || loading || mediaBusy}
                        onCorrect={setMessage}
                      />
                    </div>
                  </div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-orange-800 dark:text-orange-200">
                    <Image
                      loading="eager"
                      src="/brand/agent-mascot.png"
                      alt=""
                      width={24}
                      height={24}
                      className="brand-agent-avatar h-6 w-6"
                    />
                    拾光
                  </div>
                  {!compact &&
                    agentStatus.data?.traceEnabled &&
                    i === entries.length - 1 &&
                    (entry.reply.runId || (i === entries.length - 1 && runId)) && (
                      <AgentTrace
                        key={entry.reply.runId || runId}
                        runId={entry.reply.runId || runId}
                        live={busy && i === entries.length - 1}
                      />
                    )}
                  <AgentAnswer text={entry.reply.answer || '正在查看业务数据…'} />
                  {entry.reply.evidence
                    ?.filter((e) => e.result?.selectionRequired && e.result.candidates?.length)
                    .map((e, j) => (
                      <div key={j} className="mt-3">
                        {e.result?.matchQuality === 'SIMILAR_NAME' && (
                          <p className="mb-2 text-sm text-orange-800 dark:text-orange-200">
                            未找到“{e.result.searchedName}
                            ”的匹配。以下只是相近姓名，请核对本人后点选；不会自动替换。
                          </p>
                        )}
                        {e.result?.selectionRequired &&
                          e.result.candidates?.map((candidate) => (
                            <button
                              disabled={busy || loading || mediaBusy}
                              key={candidate.id}
                              onClick={async () => {
                                try {
                                  await api.post(
                                    '/agent/conversations/' + selected + '/select-member',
                                    { memberId: candidate.id },
                                  );
                                  await ask(
                                    undefined,
                                    e.result?.matchQuality === 'SIMILAR_NAME'
                                      ? '我已点选并确认这位真实会员。以已选会员为准，不要再次使用原图片的识别姓名，继续处理之前针对该会员的请求；没有明确请求时仅查看会员详情。'
                                      : '查看这个会员的详情和权益',
                                  );
                                } catch {
                                  setError('候选已失效或无权选择，请重新搜索');
                                }
                              }}
                              className="mr-2 mt-2 rounded-xl border border-line p-3 text-left text-sm"
                            >
                              <div className="flex items-center gap-2 font-medium">
                                <MemberAvatar compact name={candidate.name} />
                                {candidate.name} · {candidate.enabled ? '启用' : '停用'}
                              </div>
                              <div className="text-xs text-ink-muted">
                                {candidate.maskedPhone} · 选择此会员
                              </div>
                            </button>
                          ))}
                      </div>
                    ))}
                  {!compact && <AgentEvidence evidence={entry.reply.evidence || []} />}
                  {groupedActions.byTurn[i].map(renderAction)}
                  {busy && i === entries.length - 1 ? (
                    <span className="inline-block h-4 w-1 animate-pulse bg-orange-600" />
                  ) : (
                    <div className="mt-3 flex gap-3 text-ink-faint">
                      <button
                        aria-label="复制回答"
                        onClick={() => void navigator.clipboard.writeText(entry.reply.answer)}
                      >
                        <Copy size={14} />
                      </button>
                      <button aria-label="重新提问" onClick={() => setMessage(entry.question)}>
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mx-auto max-w-3xl">
            {!compact && selected && (
              <AgentTaskPlan
                key={'operations-' + selected}
                resource="operation-plan"
                conversationId={selected}
                refreshKey={taskRefresh}
                disabled={busy || mediaBusy}
                onPrompt={setMessage}
                onAction={(action) => {
                  if (renderedGeneration !== request.current) return;
                  setActions((previous) => [action, ...previous.filter((a) => a.id !== action.id)]);
                }}
                onChanged={() => {
                  if (renderedGeneration !== request.current) return;
                  const token = renderedGeneration;
                  void api
                    .get('/agent/conversations/' + selected)
                    .then((r) => {
                      if (token === request.current) setActions(r.data.data.actions || []);
                    })
                    .catch(() => undefined);
                }}
              />
            )}
            {!compact && selected && (
              <AgentTaskPlan
                key={selected}
                conversationId={selected}
                refreshKey={taskRefresh}
                disabled={busy || mediaBusy}
                onPrompt={setMessage}
                onChanged={() => {
                  if (renderedGeneration !== request.current) return;
                  const token = renderedGeneration;
                  void api
                    .get('/agent/conversations/' + selected)
                    .then((r) => {
                      if (token === request.current) setActions(r.data.data.actions || []);
                    })
                    .catch(() => undefined);
                }}
                onAction={(action) => {
                  if (renderedGeneration !== request.current) return;
                  setActions((previous) => [action, ...previous.filter((a) => a.id !== action.id)]);
                }}
              />
            )}
            {groupedActions.unattached.map(renderAction)}
            {runId && error && (
              <button
                className="my-2 text-xs text-orange-700"
                onClick={async () => {
                  try {
                    const { data } = await api.get('/agent/runs/' + runId);
                    setError('任务状态：' + data.data.status + '。已提交操作请查看确认卡结果。');
                    if (selected) await open(selected);
                  } catch {
                    setError('暂时无法核对任务，请稍后重新打开此会话');
                  }
                }}
              >
                核对本次任务与操作结果
              </button>
            )}
          </div>
          <div ref={bottom} />
        </div>
        <div className={compact ? 'px-3 pb-3' : 'px-5 pb-4 sm:px-10'}>
          {toolNotice && (
            <p role="status" className="mb-2 text-sm text-orange-800 dark:text-orange-200">
              处理提示：{toolNotice}
            </p>
          )}
          {error && (
            <p role="alert" className="mb-2 text-sm text-brick">
              {error}
            </p>
          )}
          <AgentComposer
            key={`${selected}:${composerVersion}`}
            value={message}
            onChange={setMessage}
            onSend={(text, image) => ask(undefined, text, image)}
            disabled={busy || loading || mediaBusy}
            generating={busy}
            onStop={() => abort.current?.abort()}
            onBusyChange={setMediaBusy}
            compact={compact}
          >
            {!compact && capabilities.data?.some((c) => c.key === 'prepare_import_confirm') && (
              <AgentImportAttachment
                disabled={busy || loading || mediaBusy}
                onPrompt={setMessage}
              />
            )}
          </AgentComposer>
          <p className="mt-2 text-center text-[11px] text-ink-faint">
            业务数据按当前账号权限查询，经营建议供决策参考。
          </p>
        </div>
      </section>
    </div>
  );
}
