'use client';
import Link from 'next/link';
import { CouponIssuer } from '@/components/members/member-coupons';
import { PageHeader, Card } from '@/components/ui';
import { useAppSelector } from '@/store/store';
import { Gift, Ticket, Timer, Cake, ArrowRight } from 'lucide-react';

const PLAYBOOKS = [
  {
    title: '优惠券',
    subtitle: '按消费门槛激励复购',
    href: '/marketing/coupons',
    icon: Ticket,
    permissions: ['member:view', 'member:coupon-issue'],
    steps: '建立模板 → 选择会员发放 → 下单用券',
    rules: [
      '模板设置优惠金额、使用门槛及有效期，支持单人和批量发券。',
      '下单时校验会员、券状态、有效期和金额门槛；优惠券不与会员折扣、秒杀叠加。',
      '待支付订单占用优惠券，取消或超时后释放；成功支付后核销。',
    ],
    note: '模板和发放记录分开维护，可在发放记录中追踪券的来源与使用状态。',
  },
  {
    title: '限时秒杀',
    subtitle: '用限时价格集中促销',
    href: '/marketing/seckill',
    icon: Timer,
    permissions: ['seckill:view'],
    steps: '选择商品 → 配置价格与名额 → 发布活动',
    rules: [
      '为单个商品设置秒杀价格、起止时间、活动总名额及支付时限。',
      '成交同时受活动名额和商品可售库存约束，待支付订单会占用名额及库存。',
      '取消或超时释放占用；整单退款回补普通库存，已成交的秒杀名额不返还。',
    ],
    note: '发布前核对商品库存和活动配置，活动名额不等于商品实际库存。',
  },
  {
    title: '生日关怀',
    subtitle: '在会员生日送上专属心意',
    href: '/marketing/birthday',
    icon: Cake,
    permissions: ['member:view'],
    steps: '维护生日 → 绑定券模板并启用 → 查看发放记录',
    rules: [
      '按上海日期在会员生日当天发券，每位会员每自然年最多成功发放一次。',
      '非闰年的 2 月 29 日生日按 2 月 28 日处理；生日每自然年最多修改一次。',
      '玩法需启用并配置可发放模板；失败可在记录页查看原因并明确补发。',
    ],
    note: '停用期间未记录的历史生日不追发，避免恢复后集中发放过期关怀。',
  },
  {
    title: '新会员礼包',
    subtitle: '让首次加入更有仪式感',
    href: '/marketing/welcome',
    icon: Gift,
    permissions: ['member:view'],
    steps: '选择礼包券 → 启用玩法 → 新会员自动进入发放流程',
    rules: [
      '只覆盖玩法启用期间新增的启用会员，同一会员只享一次新人资格。',
      '编辑旧会员资料或重新启用旧会员，不会重新获得新人资格。',
      '停用玩法期间不新增资格；已有待处理资格暂停，恢复启用后继续处理。',
    ],
    note: '资格记录保留当时的模板与配置版本，失败记录支持查看原因及明确补发。',
  },
];
export default function Marketing({ coupons = false }: { coupons?: boolean }) {
  const permissions = useAppSelector((s) => s.auth.user?.permissions || []);
  return (
    <>
      <PageHeader
        title={coupons ? '优惠券' : '营销中心'}
        description={
          coupons
            ? '维护优惠券模板，追踪发放与使用情况'
            : '按经营目标选择玩法，了解生效条件与执行规则'
        }
      />
      {coupons ? (
        <>
          <nav className="mb-5 flex gap-4 text-sm">
            <span className="font-medium">优惠券模板</span>
            <Link href="/marketing/coupons/records">发放记录 →</Link>
          </nav>
          <CouponIssuer templatesOnly onIssued={() => {}} />
          <Link href="/members">前往会员管理选择会员发券 →</Link>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {PLAYBOOKS.filter((play) => play.permissions.every((p) => permissions.includes(p))).map(
            (play) => (
              <Card key={play.href} className="flex flex-col p-6">
                <div className="mb-4 flex items-center gap-3">
                  <span className="rounded-xl bg-brand-tint p-3 text-brand">
                    <play.icon size={23} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold">{play.title}</h2>
                    <p className="text-sm text-ink-muted">{play.subtitle}</p>
                  </div>
                </div>
                <p className="mb-4 rounded-lg bg-sunken px-3 py-2 text-xs text-ink-muted">
                  {play.steps}
                </p>
                <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                  {play.rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
                <p className="mb-5 text-xs leading-relaxed text-ink-muted">{play.note}</p>
                <Link
                  className="mt-auto flex items-center justify-between border-t border-line pt-4 font-medium text-brand"
                  href={play.href}
                >
                  {play.title} · 配置与管理 <ArrowRight size={17} />
                </Link>
              </Card>
            ),
          )}
        </div>
      )}
    </>
  );
}
