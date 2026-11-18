'use client';

import Link from 'next/link';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 text-ink">
      <div className="max-w-lg rounded-2xl border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)]">
        <p className="text-sm font-semibold text-red-600">页面加载失败</p>
        <h1 className="mt-2 text-2xl font-bold">遇到了一点问题</h1>
        <p className="mt-3 text-sm text-ink-faint">
          可以重试当前操作；如果问题持续，请前往系统状态页确认后端服务。
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          >
            重试
          </button>
          <Link
            href="/status"
            className="rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold"
          >
            系统状态
          </Link>
        </div>
      </div>
    </main>
  );
}
