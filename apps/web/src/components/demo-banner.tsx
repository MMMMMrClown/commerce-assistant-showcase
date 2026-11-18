'use client';

import { useState } from 'react';

export function DemoBanner() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // 【结束体验】仅回收当前访客的数据副本，不触及其他访客或基准数据。
  async function finish() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/demo/end', { method: 'POST' });
      if (response.ok || response.status === 410) {
        window.location.assign('/');
        return;
      }
      const body = (await response.json()) as { message?: string };
      setMessage(body.message || '暂时无法结束，请稍后重试');
    } catch {
      setMessage('网络暂不可用，请稍后重试');
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="border-b border-sky-100 bg-sky-50 px-4 py-2 text-sm text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>独立演示：修改仅影响本次体验，空闲30分钟后自动结束。支付均为模拟。</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void finish()}
          className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
        >
          {busy ? '正在结束…' : '结束体验'}
        </button>
      </div>
      {message ? (
        <p role="status" className="mt-1 text-amber-800">
          {message}
        </p>
      ) : null}
    </aside>
  );
}
