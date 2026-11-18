'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AgentPet } from './agent-pet';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Activity,
  BarChart3,
  Boxes,
  Crown,
  Gift,
  TicketPercent,
  ClipboardList,
  CreditCard,
  RotateCcw,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ShoppingBasket,
  FileClock,
  FileUp,
  Gauge,
  LogOut,
  Menu,
  Monitor,
  Moon,
  ScrollText,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { clearAuth, useAppDispatch, useAppSelector } from '@/store/store';
import {
  Button,
  cn,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@/components/ui';

const groups = [
  {
    title: '经营分析',
    items: [
      { label: 'AI 运营助手', path: '/agent', icon: ShoppingBasket, permission: 'dashboard:view' },
      { label: '经营总览', path: '/dashboard', icon: Gauge, permission: 'dashboard:view' },
      { label: '指标口径', path: '/metrics', icon: BarChart3, permission: 'metric:view' },
    ],
  },
  {
    title: '业务数据',
    items: [{ label: '区域与门店', path: '/stores', icon: Building2, permission: 'store:view' }],
  },
  {
    title: '商品管理',
    items: [
      { label: '商品管理', path: '/products', icon: Boxes, permission: 'product:view' },
      {
        label: '分类管理',
        path: '/product-categories',
        icon: Boxes,
        permission: 'product-category:view',
      },
    ],
  },
  {
    title: '会员管理',
    items: [
      { label: '会员管理', path: '/members', icon: UsersRound, permission: 'member:view' },
      { label: '会员等级', path: '/members/tiers', icon: Crown, permission: 'member:view' },
      { label: '会员权益', path: '/members/benefits', icon: Gift, permission: 'member:view' },
    ],
  },
  {
    title: '订单管理',
    items: [
      { label: '订单列表', path: '/orders', icon: ClipboardList, permission: 'order:view' },
      { label: '支付记录', path: '/orders/payments', icon: CreditCard, permission: 'order:view' },
      { label: '退款记录', path: '/orders/refunds', icon: RotateCcw, permission: 'order:view' },
    ],
  },
  {
    title: '营销管理',
    items: [
      { label: '营销中心', path: '/marketing', icon: ShoppingBasket, permission: 'member:view' },
      {
        label: '优惠券',
        path: '/marketing/coupons',
        icon: TicketPercent,
        permission: 'member:coupon-issue',
      },
      {
        label: '优惠券发放记录',
        path: '/marketing/coupons/records',
        icon: TicketPercent,
        permission: 'member:view',
      },
      {
        label: '生日关怀',
        path: '/marketing/birthday',
        icon: UsersRound,
        permission: 'member:view',
      },
      {
        label: '新会员礼包',
        path: '/marketing/welcome',
        icon: UsersRound,
        permission: 'member:view',
      },
      {
        label: '限时秒杀',
        path: '/marketing/seckill',
        icon: ShoppingBasket,
        permission: 'seckill:view',
      },
    ],
  },
  {
    title: '数据接入',
    items: [
      {
        label: 'CSV数据导入',
        path: '/data-imports',
        icon: FileUp,
        permission: 'data-import:create',
      },
      {
        label: '导入记录',
        path: '/data-imports/history',
        icon: FileClock,
        permission: 'data-import:view',
      },
    ],
  },
  {
    title: '系统管理',
    items: [
      { label: '用户管理', path: '/system/users', icon: UsersRound, permission: 'user:view' },
      { label: '角色权限', path: '/system/roles', icon: ShieldCheck, permission: 'role:view' },
      { label: '操作日志', path: '/system/logs', icon: ScrollText, permission: 'log:view' },
    ],
  },
];
const auxiliaryItems = [
  { label: '帮助中心', path: '/help', icon: CircleHelp },
  { label: '系统状态', path: '/status', icon: Activity },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const user = useAppSelector((state) => state.auth.user);
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme } = useTheme();
  const current = groups
    .flatMap((group) => group.items)
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
  const allowedItems = [
    ...groups
      .flatMap((group) => group.items)
      .filter(
        (item) =>
          user?.permissions.includes(item.permission) ||
          (item.path === '/stores' && user?.permissions.includes('region:view')) ||
          (item.path === '/marketing' && user?.permissions.includes('seckill:view')),
      ),
    ...auxiliaryItems,
  ];
  const matchedItems = allowedItems.filter((item) =>
    item.label.toLowerCase().includes(keyword.toLowerCase()),
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!user) return null;

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      dispatch(clearAuth());
      router.replace('/login');
      router.refresh();
    }
  };

  const navigate = (path: string) => {
    setSearchOpen(false);
    setKeyword('');
    router.push(path);
  };
  return (
    <div className="flex min-h-screen bg-paper text-ink">
      {sidebarOpen && (
        <button
          aria-label="关闭导航遮罩"
          className="fixed inset-0 z-30 bg-stone-950/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={cn(
          'sidebar-healing fixed inset-y-0 left-0 z-40 w-64 border-r border-[#6C4C37] transition-transform lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="brand-sidebar-logo flex h-20 items-center gap-3 border-b px-6">
          <div className="brand-logo-mark grid h-10 w-10 place-items-center rounded-xl">
            <ShoppingBasket size={22} />
          </div>
          <div>
            <div className="brand-sidebar-title text-[15px] font-semibold">零售电商</div>
            <div className="brand-sidebar-caption mt-0.5 text-xs">全渠道经营中控台</div>
          </div>
          <button
            className="brand-sidebar-caption ml-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="关闭导航"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="h-[calc(100vh-80px)] overflow-y-auto px-3 py-5">
          {groups.map((group) => {
            const items = group.items.filter(
              (item) =>
                user.permissions.includes(item.permission) ||
                (item.path === '/stores' && user.permissions.includes('region:view')) ||
                (item.path === '/marketing' && user.permissions.includes('seckill:view')),
            );
            if (!items.length) return null;
            return (
              <div key={group.title} className="mb-6">
                <div className="brand-sidebar-group mb-1.5 px-3 text-[11px] font-medium tracking-[0.08em]">
                  {group.title}
                </div>
                {items.map((item) => {
                  const active = current?.path === item.path;
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        'brand-nav-link mb-1 flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-colors',
                        active && 'font-semibold',
                      )}
                    >
                      <item.icon size={18} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 lg:ml-64">
        <header className="brand-topbar sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line px-4 backdrop-blur sm:px-7">
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-1 transition-colors hover:bg-sunken lg:hidden"
              aria-label="打开导航"
            >
              <Menu size={20} />
            </button>
            <span className="hidden sm:inline">零售电商</span>
            <ChevronRight size={14} className="hidden sm:block" />
            <span className="font-medium text-ink">{current?.label || '个人中心'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:flex"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={15} />
              快捷搜索 <kbd className="ml-2 text-[10px]">Ctrl K</kbd>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="用户菜单"
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-sunken"
                >
                  <div className="brand-avatar grid h-9 w-9 place-items-center rounded-full bg-orange-50 text-orange-800">
                    <UserRound size={18} />
                  </div>
                  <div className="hidden text-left sm:block">
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-ink-faint">{user.roles[0]?.name}</div>
                  </div>
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => router.push('/profile')}>
                  <UserRound size={16} />
                  个人中心
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setTheme('light')}>
                  <Sun size={16} />
                  浅色主题
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTheme('dark')}>
                  <Moon size={16} />
                  深色主题
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTheme('system')}>
                  <Monitor size={16} />
                  跟随系统
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-brick" onSelect={() => void logout()}>
                  <LogOut size={16} />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="retail-workspace min-h-[calc(100vh-64px)] p-4 sm:p-7">{children}</main>
        <AgentPet key={user.id} />
      </div>
      <Dialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="快捷搜索"
        description="业务菜单按账号权限展示，帮助与状态页始终可用"
      >
        <div className="relative">
          <Search className="absolute left-3 top-3 text-ink-faint" size={17} />
          <Input
            autoFocus
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="pl-9"
            placeholder="搜索菜单名称…"
          />
        </div>
        <div className="mt-3 space-y-1">
          {matchedItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm hover:bg-sunken dark:hover:bg-sunken"
            >
              <item.icon size={17} />
              {item.label}
              <span className="ml-auto text-xs text-ink-faint">{item.path}</span>
            </button>
          ))}
          {!matchedItems.length && (
            <p className="py-6 text-center text-sm text-ink-faint">没有匹配菜单</p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
