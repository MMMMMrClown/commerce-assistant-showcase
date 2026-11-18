'use client';

import { CheckCircle2, Download, FileSpreadsheet, RotateCcw, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  StatusTabs,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { useApi } from '../hooks/use-api';
import { api, errorMessage, type PageResult } from '../lib/api';
type Task = Record<string, any>;
export function ImportPage() {
  const input = useRef<HTMLInputElement>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();
  const upload = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      setTask((await api.post('/data-imports/upload', form)).data.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  const confirm = async () => {
    if (!task) return;
    setLoading(true);
    try {
      setTask((await api.post(`/data-imports/${task.id}/confirm`)).data.data);
      toast({ title: '数据导入成功', variant: 'success' });
    } catch (e) {
      const message = errorMessage(e);
      setError(message);
      toast({ title: '导入失败', description: message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };
  const download = async () => {
    const r = await api.get('/data-imports/template');
    const blob = new Blob(['\ufeff' + r.data.data.content], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = r.data.data.fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <PageHeader
        title="CSV数据导入"
        description="上传订单CSV，先校验预览，再确认写入PostgreSQL"
        action={
          <Button variant="outline" onClick={download}>
            <Download size={16} />
            下载CSV模板
          </Button>
        }
      />
      <Card className="p-6">
        {!task && !loading && (
          <button
            onClick={() => input.current?.click()}
            className="flex min-h-64 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/40 text-orange-800 transition hover:bg-orange-50 dark:bg-orange-950/20"
          >
            <UploadCloud size={42} />
            <div className="mt-4 font-semibold">点击选择CSV文件</div>
            <div className="mt-1 text-sm text-ink-muted">
              最大2MB，最多1000行，仅支持指定订单模板
            </div>
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => upload(e.target.files?.[0])}
        />
        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}{' '}
        {task && !loading && (
          <div>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sunken p-4 dark:bg-sunken">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="text-tea" />
                <div>
                  <div className="font-medium">{task.fileName}</div>
                  <div className="text-xs text-ink-faint">
                    共{task.totalRows}行 · 正确{task.successRows}行 · 错误{task.failedRows}项
                  </div>
                </div>
              </div>
              <Badge
                tone={task.status === 'IMPORTED' ? 'green' : task.failedRows ? 'red' : 'amber'}
              >
                {task.status === 'IMPORTED'
                  ? '已导入'
                  : task.failedRows
                    ? '校验未通过'
                    : '等待确认'}
              </Badge>
            </div>
            <Tabs defaultValue="summary">
              <TabsList>
                <TabsTrigger value="summary">摘要</TabsTrigger>
                <TabsTrigger value="errors">错误明细</TabsTrigger>
                {task.previewData && <TabsTrigger value="preview">数据预览</TabsTrigger>}
              </TabsList>
              <TabsContent value="summary">
                {task.failedRows === 0 && task.status !== 'IMPORTED' && (
                  <div className="rounded-xl border border-line bg-tea-tint p-5 ">
                    <div className="flex items-center gap-2 font-semibold text-tea ">
                      <CheckCircle2 />
                      全部数据校验通过
                    </div>
                    <p className="mt-1 text-sm text-tea">
                      确认后将使用数据库事务写入订单和商品明细。
                    </p>
                    <Button className="mt-4" onClick={confirm}>
                      确认导入{task.successRows}行数据
                    </Button>
                  </div>
                )}
                {task.status === 'IMPORTED' && (
                  <div className="rounded-xl bg-tea-tint p-5 text-tea  ">
                    数据已经成功写入数据库，经营看板会立即反映最新指标。
                  </div>
                )}
              </TabsContent>
              <TabsContent value="errors">
                {task.errors?.length ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th>行号</Th>
                        <Th>字段</Th>
                        <Th>错误原因</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {task.errors.slice(0, 50).map((e: any) => (
                        <tr key={e.id}>
                          <Td>{e.rowNo}</Td>
                          <Td>{e.field || '-'}</Td>
                          <Td className="text-brick">{e.message}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <EmptyState text="没有校验错误" />
                )}
              </TabsContent>
              {task.previewData && (
                <TabsContent value="preview">
                  <pre className="max-h-96 overflow-auto rounded-xl bg-stone-950 p-4 text-xs text-stone-100">
                    {JSON.stringify(task.previewData, null, 2)}
                  </pre>
                </TabsContent>
              )}
            </Tabs>
            <Button variant="ghost" className="mt-5" onClick={() => setTask(null)}>
              重新选择文件
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
// 导入单状态标签页：key 对应 ImportStatus 枚举值，空字符串代表全部记录
const IMPORT_STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'PREVIEW', label: '校验未通过' },
  { key: 'READY', label: '待确认' },
  { key: 'IMPORTED', label: '已导入' },
  { key: 'FAILED', label: '导入失败' },
] as const;
// 状态徽章配色：已导入=green，待确认=amber，校验未通过/导入失败=red
const STATUS_TONES: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  IMPORTED: 'green',
  READY: 'amber',
  PREVIEW: 'red',
  FAILED: 'red',
};
const STATUS_LABELS: Record<string, string> = {
  PREVIEW: '校验未通过',
  READY: '待确认',
  IMPORTED: '已导入',
  FAILED: '导入失败',
};
export function ImportHistoryPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const result = useApi<PageResult<Task> & { statusCounts?: Record<string, number> }>(
    `/data-imports?page=${page}&pageSize=20&status=${encodeURIComponent(status)}`,
  );
  const items = result.data?.items ?? [];
  const counts = result.data?.statusCounts ?? null;
  return (
    <>
      <PageHeader title="导入记录" description="追踪每一次CSV校验和导入结果" />
      <StatusTabs
        tabs={IMPORT_STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
        counts={counts}
        value={status}
        onChange={(key) => {
          setStatus(key);
          setPage(1);
        }}
      />
      <Card className="p-5">
        {status && (
          <div className="mb-4">
            <Button
              variant="ghost"
              onClick={() => {
                setStatus('');
                setPage(1);
              }}
            >
              <RotateCcw size={15} />
              重置
            </Button>
          </div>
        )}
        {result.loading ? (
          <LoadingState />
        ) : result.error ? (
          <ErrorState message={result.error} />
        ) : !items.length ? (
          <EmptyState />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>文件名</Th>
                  <Th>提交人</Th>
                  <Th>提交时间</Th>
                  <Th>总行数</Th>
                  <Th>正确/错误</Th>
                  <Th>状态</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <Td>{t.fileName}</Td>
                    <Td>{t.createdBy.name}</Td>
                    <Td>{new Date(t.createdAt).toLocaleString()}</Td>
                    <Td>{t.totalRows}</Td>
                    <Td>
                      {t.successRows} / {t.failedRows}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONES[t.status] || 'neutral'}>
                        {STATUS_LABELS[t.status] || t.status}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={page}
              pageSize={20}
              total={result.data?.total || 0}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
