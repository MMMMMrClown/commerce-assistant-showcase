'use client';

/* oxlint-disable react/only-export-components -- 教学项目将小型样式工具与基础组件集中展示。 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronLeft, ChevronRight, X, LoaderCircle, Inbox, TriangleAlert } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
const buttonVariants = cva(
  'brand-button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium transition-colors active:translate-y-px disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
  {
    variants: {
      variant: {
        default:
          'bg-orange-700 text-white shadow-[var(--shadow-button)] hover:bg-orange-800 active:bg-orange-900',
        secondary: 'border border-line bg-sunken text-ink hover:bg-line active:bg-line-strong',
        outline:
          'border border-line-strong bg-surface text-ink hover:border-orange-300 hover:bg-orange-50 active:bg-orange-100 dark:hover:bg-sunken',
        ghost: 'text-ink-muted hover:bg-sunken hover:text-ink',
        danger:
          'border border-brick/30 bg-brick-tint text-brick hover:bg-brick/15 active:bg-brick/25',
      },
      size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', lg: 'h-12 px-6' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'brand-card rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
      {...props}
    />
  );
}
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'brand-control h-10 min-w-0 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-orange-600 focus:ring-2 focus:ring-orange-500/15',
        className,
      )}
      {...props}
    />
  );
}
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'brand-control h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-500/15',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
// 状态标签页：胶囊按钮 + 实时计数，点击切换筛选（订单/会员/门店等列表页通用）
export function StatusTabs({
  tabs,
  counts,
  value,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  counts: Record<string, number> | null;
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {tabs.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key || 'all'}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors active:translate-y-px',
              active
                ? 'border-orange-700 bg-orange-700 text-white shadow-[var(--shadow-button)]'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {tab.label}
            <span
              className={cn(
                'min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums',
                active ? 'bg-white/20 text-white' : 'bg-sunken text-ink-faint',
              )}
            >
              {counts ? (counts[tab.key] ?? 0) : '…'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'green' | 'red' | 'amber' | 'blue' | 'neutral';
}) {
  const tones = {
    green: 'bg-tea-tint text-tea',
    red: 'bg-brick-tint text-brick',
    amber: 'bg-ochre-tint text-ochre',
    blue: 'bg-slate-tint text-slate-tone',
    neutral: 'bg-sunken text-ink-muted',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-current/10 px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="brand-table overflow-x-auto rounded-[12px] border border-line">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}
export const Th = ({
  children,
  onSort,
  direction,
}: {
  children: ReactNode;
  onSort?: () => void;
  direction?: string;
}) => (
  <th
    aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
    className="whitespace-nowrap bg-sunken px-4 py-2.5 text-[13px] font-semibold text-ink-muted"
  >
    {onSort ? (
      <button onClick={onSort} className="inline-flex items-center gap-2">
        {children}
        <span className="text-xs">
          {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}
        </span>
      </button>
    ) : (
      children
    )}
  </th>
);
export const Td = ({ children, className }: { children: ReactNode; className?: string }) => (
  <td className={cn('border-t border-line px-4 py-3', className)}>{children}</td>
);
// 【弹窗拖动】标题栏使用指针捕获，限制窗口在视口内；重新打开时复位。
function useDialogDrag(open: boolean) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const start = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const wasOpen = useRef(open);
  if (wasOpen.current !== open) {
    wasOpen.current = open;
    if (open) setOffset({ x: 0, y: 0 });
  }
  return {
    style: { marginLeft: offset.x, marginTop: offset.y },
    handlers: {
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      },
      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const rect = e.currentTarget.closest('[role="dialog"]')!.getBoundingClientRect();
        const x = start.current.ox + e.clientX - start.current.x,
          y = start.current.oy + e.clientY - start.current.y;
        setOffset({
          x: Math.max(
            -(window.innerWidth - rect.width) / 2,
            Math.min((window.innerWidth - rect.width) / 2, x),
          ),
          y: Math.max(
            -(window.innerHeight - rect.height) / 2,
            Math.min((window.innerHeight - rect.height) / 2, y),
          ),
        });
      },
      onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      },
    },
  };
}
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const drag = useDialogDrag(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#3B2A1F]/35 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          style={drag.style}
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[var(--radius-dialog)] border border-line bg-surface p-6 shadow-[var(--shadow-overlay)]"
        >
          <div {...drag.handlers} className="mb-5 cursor-move touch-none select-none pr-8">
            <DialogPrimitive.Title className="text-xl font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          {children}
          <DialogPrimitive.Close
            aria-label="关闭"
            className="absolute right-4 top-4 rounded-md p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          >
            <X size={18} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="brand-page-header mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row">
      <div>
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1.5 max-w-[68ch] text-sm text-ink-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="flex min-h-48 items-center justify-center gap-2 text-ink-muted">
      <LoaderCircle className="animate-spin" size={20} />
      正在加载数据…
    </div>
  );
}
export function EmptyState({ text = '暂无数据' }: { text?: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center text-ink-faint">
      <Inbox size={34} />
      <p className="mt-2 text-sm">{text}</p>
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center text-brick">
      <TriangleAlert size={32} />
      <p className="mt-2 text-sm">{message}</p>
      {retry && (
        <Button className="mt-3" variant="outline" size="sm" onClick={retry}>
          重新加载
        </Button>
      )}
    </div>
  );
}

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export function DropdownMenuContent({
  children,
  className,
  align = 'end',
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={8}
        className={cn(
          'z-50 min-w-48 rounded-[12px] border border-line bg-surface p-1.5 shadow-[var(--shadow-overlay)]',
          className,
        )}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem({
  children,
  onSelect,
  className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  className?: string;
}) {
  return (
    <DropdownPrimitive.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-md px-3 py-2 text-sm text-ink outline-none focus:bg-sunken',
        className,
      )}
    >
      {children}
    </DropdownPrimitive.Item>
  );
}
export const DropdownMenuSeparator = () => (
  <DropdownPrimitive.Separator className="my-1 h-px bg-line" />
);

export const Tabs = TabsPrimitive.Root;
export function TabsList({ children }: { children: ReactNode }) {
  return (
    <TabsPrimitive.List className="inline-flex rounded-xl border border-line bg-sunken p-1">
      {children}
    </TabsPrimitive.List>
  );
}
export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="rounded-[9px] px-4 py-2 text-sm text-ink-muted outline-none transition-colors hover:text-ink data-[state=active]:bg-orange-700 data-[state=active]:text-white data-[state=active]:shadow-[var(--shadow-button)]"
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}
export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Content value={value} className={cn('mt-5 outline-none', className)}>
      {children}
    </TabsPrimitive.Content>
  );
}

export function Tooltip({ children, content }: { children: ReactNode; content: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-[70] max-w-64 rounded-md bg-ink px-3 py-2 text-xs text-paper shadow-lg"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-ink" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
export function Popover({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={8}
          className="z-50 w-72 rounded-[12px] border border-line bg-surface p-4 text-sm text-ink shadow-[var(--shadow-overlay)]"
        >
          {children}
          <PopoverPrimitive.Arrow className="fill-surface" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const drag = useDialogDrag(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#3B2A1F]/35 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          style={drag.style}
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-dialog)] border border-line bg-surface p-6 shadow-[var(--shadow-overlay)]"
        >
          <DialogPrimitive.Title asChild>
            <div
              {...drag.handlers}
              className="cursor-move touch-none select-none pr-8 text-xl font-semibold text-ink"
            >
              {title}
            </div>
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">
              {description}
            </DialogPrimitive.Description>
          )}
          <div className="mt-6">{children}</div>
          <DialogPrimitive.Close
            aria-label="关闭"
            className="absolute right-4 top-4 rounded-md p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          >
            <X size={18} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="正在加载"
      className={cn('animate-pulse rounded-md bg-sunken', className)}
    />
  );
}
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav aria-label="分页" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-muted tabular-nums">
        共 {total} 条，第 {page}/{pages} 页
      </span>
      <div className="flex gap-2">
        <Button
          aria-label="上一页"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={15} />
        </Button>
        <Button
          aria-label="下一页"
          size="sm"
          variant="outline"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={15} />
        </Button>
      </div>
    </nav>
  );
}

type ToastData = { id: number; title: string; description?: string; variant?: 'success' | 'error' };
const ToastContext = createContext<{ toast: (data: Omit<ToastData, 'id'>) => void } | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastData[]>([]);
  const toast = useCallback(
    (data: Omit<ToastData, 'id'>) => setItems((x) => [...x, { ...data, id: Date.now() }]),
    [],
  );
  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            duration={3500}
            onOpenChange={(open) => {
              if (!open) setItems((x) => x.filter((i) => i.id !== item.id));
            }}
            className={cn(
              'rounded-[10px] border border-l-[3px] border-line bg-surface p-4 shadow-lg',
              item.variant === 'error' ? 'border-l-brick' : 'border-l-tea',
            )}
          >
            <ToastPrimitive.Title className="font-medium">{item.title}</ToastPrimitive.Title>
            {item.description && (
              <ToastPrimitive.Description className="mt-1 text-sm text-ink-muted">
                {item.description}
              </ToastPrimitive.Description>
            )}
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used within ToastProvider');
  return value;
}
