'use client';
import { useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import { Button } from './ui';
export function AgentImportAttachment({
  disabled,
  onPrompt,
}: {
  disabled: boolean;
  onPrompt: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    working = useRef(false);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  async function upload(file?: File) {
    if (!file || working.current || disabled) return;
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 2 * 1024 * 1024) {
      setError('请选择不超过2MB的订单CSV文件');
      return;
    }
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.append('file', file);
      const r = (await api.post('/data-imports/upload', form)).data.data;
      setNotice(
        `${r.fileName}：共${r.totalRows}行，通过${r.successRows}行，错误${r.failedRows}项。尚未导入订单。`,
      );
      onPrompt(
        `请检查刚上传的历史订单CSV任务，任务ID：${r.id}。校验通过后给我导入确认卡，有错误请说明修复方法。`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      working.current = false;
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <div className="mb-2 text-xs text-ink-muted">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={14} />
          {busy ? '正在校验CSV' : '附加订单CSV'}
        </Button>
        <Link href="/data-imports" className="underline">
          下载模板
        </Link>
        <span>只做文件校验，导入仍须确认</span>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          aria-label="附加订单CSV文件"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </div>
      {notice && (
        <p className="px-2 py-1" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="px-2 py-1 text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
