'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  ClipboardList,
  CreditCard,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Sprout,
  Store,
  TicketPercent,
  UserRound,
  UsersRound,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Button, Input } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { loadMe, useAppDispatch } from '../store/store';

const schema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(6, '密码至少6位'),
});
type FormData = z.infer<typeof schema>;

const DEMO_PASSWORD = 'Sunny@123456';

// 底部横幅：与左侧导航一致的六个业务模块
const modules = [
  {
    label: '商品管理',
    desc: '上架 / 库存 / 分类',
    icon: Boxes,
    tone: 'bg-[#FFEFE0] text-[#C7532E]',
  },
  {
    label: '会员体系',
    desc: '会员 / 权益 / 积分',
    icon: UsersRound,
    tone: 'bg-[#F7EDDA] text-[#926821]',
  },
  {
    label: '营销活动',
    desc: '折扣 / 秒杀 / 促销',
    icon: TicketPercent,
    tone: 'bg-[#F9E7E1] text-[#A84635]',
  },
  {
    label: '订单管理',
    desc: '下单 / 发货 / 售后',
    icon: ClipboardList,
    tone: 'bg-[#EAF0F1] text-[#586F75]',
  },
  {
    label: '支付与退款',
    desc: '支付 / 退款 / 对账',
    icon: CreditCard,
    tone: 'bg-[#EDF2E7] text-[#54704A]',
  },
  {
    label: '经营分析',
    desc: '销售 / 会员 / 活动',
    icon: BarChart3,
    tone: 'bg-[#F7EDDA] text-[#926821]',
  },
];

// 浮在场景上的功能气泡（坐标相对主视觉区域，避开机器人头部）
const bubbles = [
  { label: '库存', icon: Boxes, className: 'left-[41%] top-[37%]', delay: '0s' },
  { label: '订单', icon: ClipboardList, className: 'left-[47%] top-[17%]', delay: '1.1s' },
  { label: '会员', icon: UsersRound, className: 'right-[18%] top-[6%]', delay: '2.2s' },
  { label: '营销', icon: TicketPercent, className: 'right-[2%] top-[28%]', delay: '0.6s' },
  { label: '经营分析', icon: BarChart3, className: 'right-[1%] top-[65%]', delay: '1.7s' },
];

const aiPoints = [
  '自然对话，快速查询并解释真实经营数据',
  '订单、会员与营销操作，先预览再由你确认',
  '结合经营表现提供建议，辅助日常运营决策',
];

const REMEMBER_KEY = 'retail:last-username';

export default function LoginPage({
  demoPassword = DEMO_PASSWORD,
}: { demoPassword?: string } = {}) {
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();
  const dispatch = useAppDispatch();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { username: 'admin', password: demoPassword },
  });

  useEffect(() => {
    const saved = window.localStorage.getItem(REMEMBER_KEY);
    if (saved) setValue('username', saved);
    else if (window.localStorage.getItem(`${REMEMBER_KEY}:enabled`) === '0') setRemember(false);
  }, [setValue]);

  const submit = async (values: FormData) => {
    setError('');
    try {
      await api.post('/auth/login', values);
      if (remember) {
        window.localStorage.setItem(REMEMBER_KEY, values.username);
        window.localStorage.setItem(`${REMEMBER_KEY}:enabled`, '1');
      } else {
        window.localStorage.removeItem(REMEMBER_KEY);
        window.localStorage.setItem(`${REMEMBER_KEY}:enabled`, '0');
      }
      await dispatch(loadMe()).unwrap();
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const fillAccount = (username: string) => {
    setValue('username', username, { shouldValidate: true });
    setValue('password', demoPassword, { shouldValidate: true });
  };

  return (
    <div className="brand-login min-h-screen bg-[#FBF3E8] px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
      <div className="mx-auto w-full max-w-[1320px]">
        {/* 上半：主视觉场景 + 叠加登录卡 */}
        <section className="brand-login-scene relative overflow-hidden rounded-[30px] ring-1 ring-line">
          {/* 3D 场景作为整块背景铺满，左缘虚化与页面融合 */}
          <div className="pointer-events-none absolute inset-y-4 right-[5%] hidden w-[47%] lg:block">
            <Image
              loading="eager"
              src="/brand/agent-cottage-garden.png"
              alt="拾光在洒满阳光的小屋里敲键盘，窗台旁摆着绿植"
              fill
              priority
              sizes="(max-width: 1320px) 47vw, 620px"
              className="brand-agent-avatar object-contain"
            />
          </div>
          {/* 低矮前景限定在上半区右侧，不占用表单及下半区。 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 right-[1%] hidden h-[280px] w-[67%] lg:block"
          >
            <Image
              src="/brand/login-garden-border.png"
              alt=""
              fill
              sizes="(max-width: 1320px) 67vw, 885px"
              className="object-contain object-bottom"
            />
          </div>
          {/* 左侧柔和过渡，让场景与登录卡自然衔接 */}
          <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-[#FCEFDE]/60 to-transparent to-45% lg:block" />

          <div className="relative z-10 flex flex-col px-6 py-7 sm:px-9 lg:min-h-[560px] lg:justify-between lg:px-10 lg:py-6">
            {/* 品牌 */}
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#EE7038] to-[#C7532E] text-white shadow-[0_10px_22px_-10px_rgba(199,78,26,0.75)]">
                <ShoppingBasket size={18} />
              </div>
              <div>
                <div className="flex items-baseline gap-1 text-[16px] font-bold leading-none text-[#3B2A1F]">
                  零售电商
                  <span className="text-[#C7532E]">中控台</span>
                </div>
                <div className="mt-1 text-[10px] tracking-[0.12em] text-[#a08b74]">
                  全渠道经营管理平台
                </div>
              </div>
            </div>

            {/* 登录卡 */}
            <div className="mx-auto mt-4 w-full max-w-[360px] rounded-[26px] border border-white/85 bg-white/72 p-5 shadow-[0_30px_70px_-34px_rgba(150,84,40,0.55)] backdrop-blur-md sm:p-6 lg:mx-0 lg:self-start">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FDF3E1] px-2.5 py-1 text-[10.5px] font-medium text-[#B06A2E]">
                <Sprout size={11} />
                欢迎回来
              </span>

              <h1 className="mt-2.5 text-[25px] font-bold leading-[1.22] tracking-tight text-[#3B2A1F]">
                登录
                <br />
                <span className="text-[#C7532E]">零售电商中控台</span>
              </h1>
              <p className="mt-2 text-[11.5px] leading-[1.62] text-[#8a7663]">
                面向门店与全渠道的经营管理平台，覆盖商品、营销、订单、会员与支付退款全链路。
              </p>

              <form onSubmit={handleSubmit(submit)} className="mt-3.5 space-y-2.5">
                <div className="relative">
                  <UserRound
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#b09c88]"
                  />
                  <Input
                    {...register('username')}
                    aria-label="用户名"
                    placeholder="请输入用户名"
                    className="h-10 rounded-xl border-[#EADCC9] bg-white/95 pl-9 text-[12.5px] text-[#3B2A1F] placeholder:text-[#b8a894] focus:border-[#C7532E] focus:ring-[#C7532E]/15"
                  />
                  {errors.username?.message && (
                    <span className="mt-1 block text-[10.5px] text-[#A63A28]">
                      {errors.username.message}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <LockKeyhole
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#b09c88]"
                  />
                  <Input
                    {...register('password')}
                    type={show ? 'text' : 'password'}
                    aria-label="密码"
                    placeholder="请输入密码"
                    className="h-10 rounded-xl border-[#EADCC9] bg-white/95 pl-9 pr-10 text-[12.5px] text-[#3B2A1F] placeholder:text-[#b8a894] focus:border-[#C7532E] focus:ring-[#C7532E]/15"
                  />
                  <button
                    type="button"
                    aria-label={show ? '隐藏密码' : '显示密码'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#b09c88] transition hover:text-[#7a6555]"
                    onClick={() => setShow(!show)}
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  {errors.password?.message && (
                    <span className="mt-1 block text-[10.5px] text-[#A63A28]">
                      {errors.password.message}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-[#7a6555]">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-[#E0CFB8] accent-[#C7532E]"
                    />
                    记住用户名
                  </label>
                  <span className="text-[10.5px] text-[#a89684]">忘记密码请联系管理员</span>
                </div>

                {error && (
                  <div className="rounded-xl bg-[#FDECE6] px-3 py-2 text-[12px] text-[#A63A28]">
                    {error}
                  </div>
                )}

                <Button
                  className="h-11 w-full rounded-full bg-gradient-to-r from-[#D8794B] to-[#C7532E] text-[13px] text-white shadow-[0_14px_28px_-14px_rgba(210,80,26,0.85)] hover:from-[#E06E35] hover:to-[#A9472A]"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? '正在登录…' : '登录'}
                  {!isSubmitting && <ArrowRight size={16} />}
                </Button>
              </form>

              <div className="my-3 flex items-center gap-2.5 text-[10.5px] text-[#b09c88]">
                <span className="h-px flex-1 bg-[#EFE0CC]" />
                或使用演示账号
                <span className="h-px flex-1 bg-[#EFE0CC]" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => fillAccount('admin')}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-[#EDDCC7] bg-white/90 px-2 py-2 text-[11.5px] text-[#6b5747] transition hover:border-[#C7532E]/55 hover:bg-[#FFF9F2]"
                >
                  <ShieldCheck size={13} className="text-[#C7532E]" />
                  管理员登录
                </button>
                <button
                  type="button"
                  onClick={() => fillAccount('store.manager')}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-[#EDDCC7] bg-white/90 px-2 py-2 text-[11.5px] text-[#6b5747] transition hover:border-[#C7532E]/55 hover:bg-[#FFF9F2]"
                >
                  <Store size={13} className="text-[#C7532E]" />
                  门店店长登录
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-[#a89684]">
                演示账号密码统一为 {demoPassword}
              </p>
            </div>

            {/* 场景功能气泡 */}
            <div className="pointer-events-none absolute inset-0 hidden lg:block">
              {bubbles.map((bubble) => (
                <div
                  key={bubble.label}
                  className={`absolute flex items-center gap-2 rounded-xl border border-[#E9D7BB]/70 bg-[#FFF9EA]/80 px-3 py-2 text-[11px] font-medium text-[#786351] shadow-[0_4px_14px_-10px_rgba(121,82,42,0.3)] ${bubble.className}`}
                  style={{ animationDelay: bubble.delay }}
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#FFF1E5] text-[#C7532E]">
                    <bubble.icon size={11} />
                  </span>
                  {bubble.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 下半：项目介绍横幅 */}
        <section className="relative mt-3 overflow-hidden rounded-[28px] bg-[#F2E6D7] px-5 py-6 sm:px-8 lg:mt-4 lg:px-10 lg:py-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
            <div className="shrink-0 lg:w-[360px] lg:pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#9b7c5c]">零售电商 · 数据中控台</span>
              </div>
              <h2 className="mt-2.5 text-[30px] font-bold tracking-tight text-[#3B2A1F]">
                零售电商中控台
              </h2>
              <p className="mt-2 text-[11.5px] leading-[1.85] text-[#8a7663]">
                面向商家与门店的运营管理与智能经营平台，覆盖「商品 · 营销 · 订单 · 会员 · 支付 ·
                退款」全链路，并内置专属
                <span className="mx-0.5 inline-flex items-center whitespace-nowrap rounded-full bg-[#C7532E] px-1.5 py-[1px] align-[1px] text-[9.5px] font-medium text-white">
                  AI 经营助手
                </span>
                ，助力高效运营与业务增长。
              </p>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {modules.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-white/80 bg-white/90 px-2.5 py-4 text-center shadow-[0_14px_30px_-24px_rgba(150,90,45,0.9)]"
                >
                  <span
                    className={`mx-auto grid h-10 w-10 place-items-center rounded-xl ${item.tone}`}
                  >
                    <item.icon size={18} />
                  </span>
                  <div className="mt-2 text-[12.5px] font-semibold text-[#3B2A1F]">
                    {item.label}
                  </div>
                  <div className="mt-1 text-[10px] leading-[1.5] text-[#a89684]">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-4 border-t border-[#F2D9BC] pt-4">
            <Image
              loading="eager"
              src="/brand/agent-mascot.png"
              alt="零售电商 AI 经营助手与小猫"
              width={1254}
              height={1254}
              className="pointer-events-none hidden h-[84px] w-[84px] shrink-0 object-contain select-none sm:block"
            />
            <div className="grid min-w-0 flex-1 items-center gap-4 sm:grid-cols-2 xl:grid-cols-[auto_1fr_1fr_1fr]">
              <span className="flex items-center gap-1.5 rounded-full bg-[#FFF6E8] px-3 py-1.5 text-[12px] font-semibold text-[#3B2A1F]">
                <Sparkles size={13} className="text-[#C7532E]" />
                内置 AI 经营助手
              </span>
              {aiPoints.map((text) => (
                <span key={text} className="flex items-center gap-1.5 text-[11px] text-[#8a7663]">
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-[#C7532E] text-white">
                    <Check size={10} strokeWidth={3.2} />
                  </span>
                  {text}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
