/* oxlint-disable react/only-export-components -- Next.js pages colocate metadata with the component. */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '帮助中心',
  description: '零售电商智能运营中控台功能与快捷键帮助',
};

const features = [
  ['经营分析', '在经营总览中查看营业额、订单、客单价、门店与商品排行，并按日期、区域和门店筛选。'],
  ['业务数据', '维护区域、门店、商品分类和商品资料；订单中心支持按业务条件查询订单。'],
  ['数据接入', '通过 CSV 导入业务数据，并在导入记录中追踪处理结果和失败原因。'],
  ['系统管理', '管理员可维护用户、角色权限和数据范围，并通过操作日志审计关键行为。'],
];

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-paper px-5 py-12 text-ink sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-orange-700">零售电商 · 公开帮助</p>
            <h1 className="mt-2 text-3xl font-bold sm:text-4xl">帮助中心</h1>
            <p className="mt-3 max-w-2xl text-ink-faint">
              快速了解数据中控台的主要能力、常用操作和键盘快捷键。
            </p>
          </div>
          <Link
            href="/login"
            className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          >
            进入中控台
          </Link>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          {features.map(([title, description]) => (
            <article
              key={title}
              className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]"
            >
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-ink-faint">{description}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-lg font-semibold">快捷键与使用提示</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-sunken p-4">
              <kbd className="rounded border border-line-strong bg-surface px-2 py-1 text-xs">
                Ctrl / ⌘ + K
              </kbd>
              <p className="mt-3 text-sm text-ink-faint">
                在已登录页面打开快捷搜索，可按当前权限跳转业务菜单，也可访问帮助与状态页。
              </p>
            </div>
            <div className="rounded-xl bg-sunken p-4">
              <p className="font-medium">筛选与权限</p>
              <p className="mt-2 text-sm text-ink-faint">
                页面结果受账号的数据范围约束。筛选条件变化后会自动刷新；如无菜单，请联系管理员检查角色权限。
              </p>
            </div>
          </div>
        </section>

        <div className="mt-8 text-sm">
          <Link href="/status" className="font-semibold text-orange-700 hover:underline">
            查看系统状态 →
          </Link>
        </div>
      </div>
    </main>
  );
}
