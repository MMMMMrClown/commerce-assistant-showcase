'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, PanelRightClose, Volume2, VolumeX, Plus } from 'lucide-react';
import { useAppSelector } from '@/store/store';
const QuickAgent = dynamic(() => import('@/views/agent'), {
  ssr: false,
  loading: () => <p className="p-5 text-sm">正在打开拾光…</p>,
});
type Position = {
  x: number;
  y: number;
  dock: 'left' | 'right' | null;
  hidden: boolean;
  quiet: boolean;
};
const W = 120,
  H = 178;
function clampPet(x: number, y: number, width: number, height: number) {
  return { x: Math.max(0, Math.min(width - W, x)), y: Math.max(0, Math.min(height - H, y)) };
}
const greetings = [
  '点我聊聊，也可以拖到边侧收起。',
  '忙碌之余，也记得喝口水。',
  '我在这里，陪你理清经营思路。',
];
export function AgentPet() {
  const user = useAppSelector((s) => s.auth.user),
    pathname = usePathname();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  const key = 'retail:pet:v1:' + (user?.id || '');
  const [position, setPosition] = useState<Position | null>(null);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [welcoming, setWelcoming] = useState(false);
  const [conversation, setConversation] = useState(''),
    [epoch, setEpoch] = useState(0);
  const [bubble, setBubble] = useState(''),
    [paused, setPaused] = useState(false),
    [modal, setModal] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(
    null,
  );
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const defaults: Position = {
      ...clampPet(innerWidth - W - 24, innerHeight - H - 24, innerWidth, innerHeight),
      dock: null,
      hidden: false,
      quiet: false,
    };
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y))
        Object.assign(defaults, clampPet(saved.x, saved.y, innerWidth, innerHeight), {
          dock: ['left', 'right'].includes(saved.dock) ? saved.dock : null,
          hidden: saved.hidden === true,
          quiet: saved.quiet === true,
        });
    } catch {}
    if (innerWidth < 640) defaults.dock = 'right';
    setPosition(defaults);
    setOpen(false);
    setConversation('');
  }, [key]);
  useEffect(() => {
    if (position)
      try {
        localStorage.setItem(key, JSON.stringify(position));
      } catch {}
  }, [key, position]);
  useEffect(() => {
    const resize = () =>
      setPosition((p) => (p ? { ...p, ...clampPet(p.x, p.y, innerWidth, innerHeight) } : p));
    const visibility = () => setPaused(document.hidden);
    const checkModal = () =>
      setModal(
        [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
          (el) =>
            !el.closest('[data-agent-pet]') &&
            (el.getAttribute('aria-modal') === 'true' || el.getAttribute('data-state') === 'open'),
        ),
      );
    const observer = new MutationObserver(checkModal);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'data-state'],
    });
    checkModal();
    visibility();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector('textarea')?.focus());
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', escape);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  const canBubble =
    !!position &&
    !position.hidden &&
    !position.dock &&
    !position.quiet &&
    !open &&
    !paused &&
    !modal &&
    pathname !== '/agent';
  useEffect(() => {
    if (!canBubble) {
      setBubble('');
      return;
    }
    let hide: ReturnType<typeof setTimeout>;
    let n = 0;
    const greet = () => {
      setBubble(greetings[n++ % greetings.length]);
      hide = setTimeout(() => setBubble(''), 5000);
    };
    const first = setTimeout(greet, 20000),
      repeat = setInterval(greet, 100000);
    return () => {
      clearTimeout(first);
      clearTimeout(hide);
      clearInterval(repeat);
    };
  }, [canBubble]);
  if (!user?.permissions.includes('dashboard:view') || !position || pathname === '/agent' || modal)
    return null;
  const closeChat = () => {
    setOpen(false);
    setBusy(false);
  };
  const dock = () => {
    closeChat();
    setPosition((p) => (p ? { ...p, dock: p.x < innerWidth / 2 ? 'left' : 'right' } : p));
  };
  if (position.hidden)
    return (
      <button
        aria-label="恢复拾光页面宠物"
        onClick={() => setPosition({ ...position, hidden: false, dock: 'right' })}
        className="fixed bottom-4 right-4 z-40 rounded-full border border-line bg-surface px-3 py-2 text-xs text-brand shadow-sm"
      >
        显示拾光
      </button>
    );
  return (
    <div data-agent-pet className="brand-pet" data-paused={paused}>
      {!open &&
        (position.dock ? (
          <button
            aria-label="恢复贴边的拾光"
            className={
              'fixed z-40 h-20 w-7 rounded-lg border border-line bg-surface text-xs text-brand shadow-sm ' +
              (position.dock === 'left' ? 'left-0' : 'right-0')
            }
            style={{ top: position.y + 40, writingMode: 'vertical-rl' }}
            onClick={() =>
              setPosition({
                ...position,
                dock: null,
                ...clampPet(
                  position.dock === 'left' ? 12 : innerWidth - W - 12,
                  position.y,
                  innerWidth,
                  innerHeight,
                ),
              })
            }
          >
            拾光 {position.dock === 'left' ? '›' : '‹'}
          </button>
        ) : (
          <div
            className="group fixed z-40"
            style={{ left: position.x, top: position.y, width: W, height: H }}
          >
            {bubble && (
              <div
                role="status"
                className="absolute bottom-full right-0 mb-1 w-48 rounded-2xl border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink-muted shadow-sm"
              >
                {bubble}
              </div>
            )}
            <div className="absolute -top-6 right-0 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                aria-label="收起到边侧"
                onClick={dock}
                className="rounded-full bg-surface p-1.5 text-ink-muted shadow-sm"
              >
                <PanelRightClose size={14} />
              </button>
              <button
                aria-label="关闭页面宠物"
                onClick={() => setPosition({ ...position, hidden: true })}
                className="rounded-full bg-surface p-1.5 text-ink-muted shadow-sm"
              >
                <X size={14} />
              </button>
            </div>
            <button
              aria-label="与拾光快捷对话，可拖动移动"
              className="brand-pet-body h-full w-full touch-none rounded-3xl outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
              style={{ cursor: 'grab' }}
              onMouseEnter={() => setWelcoming(true)}
              onMouseLeave={() => setWelcoming(false)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  px: position.x,
                  py: position.y,
                  moved: false,
                };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
                if (d.moved) {
                  const next = clampPet(
                    d.px + e.clientX - d.x,
                    d.py + e.clientY - d.y,
                    innerWidth,
                    innerHeight,
                  );
                  setPosition((p) => (p ? { ...p, ...next } : p));
                }
              }}
              onPointerUp={(e) => {
                const d = drag.current;
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
                if (d?.moved)
                  setPosition((p) =>
                    p
                      ? {
                          ...p,
                          dock: p.x < 28 ? 'left' : p.x > innerWidth - W - 28 ? 'right' : null,
                        }
                      : p,
                  );
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(e) => {
                const delta: Record<string, [number, number]> = {
                  ArrowLeft: [-20, 0],
                  ArrowRight: [20, 0],
                  ArrowUp: [0, -20],
                  ArrowDown: [0, 20],
                };
                if (delta[e.key]) {
                  e.preventDefault();
                  const [x, y] = delta[e.key];
                  setPosition({
                    ...position,
                    ...clampPet(position.x + x, position.y + y, innerWidth, innerHeight),
                  });
                }
              }}
              onClick={(e) => {
                if (drag.current?.moved && e.detail !== 0) return;
                setOpen(true);
                setBubble('');
              }}
            >
              <span
                aria-hidden
                className="brand-pet-sprite block h-full w-full"
                style={{
                  backgroundImage: 'url(/brand/pet-poses.png)',
                  backgroundSize: '300% 100%',
                  backgroundPosition: welcoming ? '50% 0' : '0 0',
                }}
              />
            </button>
          </div>
        ))}
      {open && (
        <section
          ref={panel}
          role="dialog"
          aria-label="拾光快捷对话"
          aria-modal={false}
          className="fixed bottom-3 right-3 z-40 flex h-[min(650px,calc(100dvh-90px))] w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-line bg-sunken px-3 py-2 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <MessageCircle size={16} />
              拾光快捷对话{' '}
              {busy && (
                <span role="status" className="text-xs text-ink-muted">
                  正在整理…
                </span>
              )}
            </span>
            <div className="flex gap-1">
              <button
                aria-label="新建快捷会话"
                disabled={busy}
                className="rounded p-1.5 hover:bg-surface"
                onClick={() => {
                  setConversation('');
                  setEpoch((n) => n + 1);
                }}
              >
                <Plus size={15} />
              </button>
              <button
                aria-label={position.quiet ? '开启闲聊气泡' : '关闭闲聊气泡'}
                className="rounded p-1.5 hover:bg-surface"
                onClick={() => setPosition({ ...position, quiet: !position.quiet })}
              >
                {position.quiet ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              <button
                aria-label="收起快捷对话"
                className="rounded p-1.5 hover:bg-surface"
                onClick={closeChat}
              >
                <X size={16} />
              </button>
            </div>
          </header>
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs text-ink-muted">
            <span>查询复用原助手，业务确认到完整页面完成。</span>
            <Link
              className="shrink-0 text-brand"
              href={
                '/agent' +
                (conversation ? '?conversationId=' + encodeURIComponent(conversation) : '')
              }
            >
              完整助手 ↗
            </Link>
          </div>
          <div className="min-h-0 flex-1">
            <QuickAgent
              key={epoch}
              compact
              initialConversationId={conversation}
              onSessionChange={setConversation}
              onBusyChange={setBusy}
            />
          </div>
        </section>
      )}
    </div>
  );
}
