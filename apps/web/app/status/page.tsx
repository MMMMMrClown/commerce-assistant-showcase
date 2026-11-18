/* oxlint-disable react/only-export-components -- Next.js pages colocate route config and metadata. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { serverApiFetch } from '@/lib/api-server';

export const revalidate = 60;

export const metadata: Metadata = {
  title: '系统状态',
  description: '零售电商智能运营中控台服务健康状态',
};

type Health = {
  status?: string;
  database?: string;
  timestamp?: string;
  uptime?: number;
};

export default async function StatusPage() {
  const generatedAt = new Date();
  let health: Health | null = null;
  let unavailableReason = '';

  try {
    health = await serverApiFetch<Health>('/health', { next: { revalidate: 60 } });
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message : '健康检查暂时不可用';
  }

  const healthy = health?.status === 'ok' || health?.status === 'healthy';
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 py-12 text-ink">
      <div className="w-full max-w-2xl rounded-3xl border border-line bg-surface p-7 shadow-[var(--shadow-card)] sm:p-10">
        <p className="text-sm font-semibold text-orange-700">零售电商 · 服务状态</p>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">系统状态</h1>
            <p className="mt-2 text-ink-faint">来自 Nest API 的公开健康检查。</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${healthy ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-900'}`}
          >
            {healthy ? '运行正常' : '状态未知'}
          </span>
        </div>

        {health ? (
          <dl className="mt-8 grid gap-3 sm:grid-cols-2">
            <StatusItem label="API 状态" value={health.status ?? '已响应'} />
            <StatusItem label="数据库" value={health.database ?? '未提供详情'} />
            <StatusItem
              label="服务运行时长"
              value={
                typeof health.uptime === 'number' ? `${Math.floor(health.uptime)} 秒` : '未提供详情'
              }
            />
            <StatusItem
              label="服务时间"
              value={
                health.timestamp ? new Date(health.timestamp).toLocaleString('zh-CN') : '未提供详情'
              }
            />
          </dl>
        ) : (
          <div className="mt-8 rounded-2xl border border-orange-200 bg-orange-50 p-5 text-orange-950 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200">
            <p className="font-semibold">暂时无法确认服务状态</p>
            <p className="mt-1 text-sm opacity-80">
              {unavailableReason}。这不影响状态页构建，服务恢复后缓存更新会重新检查。
            </p>
          </div>
        )}

        <div className="mt-8 border-t border-line pt-5 text-xs leading-5 text-ink-faint">
          <p>本页采用 ISR，最多每 60 秒重新验证一次健康检查结果。</p>
          <p>
            本次页面生成时间：{generatedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          </p>
        </div>
        <div className="mt-6 flex gap-4 text-sm font-semibold text-orange-700">
          <Link href="/help" className="hover:underline">
            帮助中心
          </Link>
          <Link href="/login" className="hover:underline">
            进入中控台
          </Link>
        </div>
      </div>
    </main>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-sunken p-4">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}
