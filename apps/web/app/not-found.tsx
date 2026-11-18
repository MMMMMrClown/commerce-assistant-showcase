import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 text-ink">
      <div className="text-center">
        <p className="text-7xl font-black text-orange-600">404</p>
        <h1 className="mt-4 text-2xl font-bold">页面不存在</h1>
        <p className="mt-2 text-ink-faint">地址可能已变更，或当前链接输入有误。</p>
        <div className="mt-7 flex justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          >
            返回中控台
          </Link>
          <Link
            href="/help"
            className="rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold"
          >
            帮助中心
          </Link>
        </div>
      </div>
    </main>
  );
}
