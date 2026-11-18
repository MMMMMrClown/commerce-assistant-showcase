'use client';
import { useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from './ui';
import type { AgentAction } from './agent-action';
const local = (value: string) => {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function SeckillProposalEditor({
  action,
  disabled,
  onReplaced,
  onEditing,
}: {
  action: AgentAction;
  disabled?: boolean;
  onReplaced: (action: AgentAction) => void;
  onEditing: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const working = useRef(false);
  const input = action.payload.input!;
  const [fields, setFields] = useState({
    name: input.name,
    price: input.price || '',
    stock: String(input.stock || ''),
    startsAt: local(input.startsAt!),
    endsAt: local(input.endsAt!),
    holdMinutes: String(input.holdMinutes || 5),
  });
  const change = (key: keyof typeof fields, value: string) =>
    setFields((v) => ({ ...v, [key]: value }));
  const close = () => {
    setEditing(false);
    onEditing(false);
  };
  async function save() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/agent/actions/' + action.id + '/seckill-proposal', {
        expectedHash: action.payloadHash,
        expectedVersion: action.version,
        changes: {
          name: fields.name,
          price: fields.price,
          stock: Number(fields.stock),
          startsAt: new Date(fields.startsAt).toISOString(),
          endsAt: new Date(fields.endsAt).toISOString(),
          holdMinutes: Number(fields.holdMinutes),
        },
      });
      close();
      onReplaced(r.data.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="my-4 rounded-xl bg-white/70 p-4 dark:bg-stone-950/40">
      <p className="font-medium">建议方案 · 尚未发布</p>
      <p className="mt-2 leading-7">{action.payload.proposal?.rationale}</p>
      <p className="mt-2 text-xs text-ink-muted">{action.payload.proposal?.notice}</p>
      {action.status === 'WAITING_CONFIRMATION' &&
        (!editing ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={disabled}
            onClick={() => {
              setEditing(true);
              onEditing(true);
            }}
          >
            修改方案
          </Button>
        ) : (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {(
              [
                ['name', '活动名称', 'text'],
                ['price', '秒杀价', 'number'],
                ['stock', '建议名额', 'number'],
                ['startsAt', '开始时间（本机时区）', 'datetime-local'],
                ['endsAt', '结束时间（本机时区）', 'datetime-local'],
                ['holdMinutes', '待支付占用分钟', 'number'],
              ] as const
            ).map(([key, label, type]) => (
              <label key={key} className="text-xs">
                {label}
                <input
                  required
                  aria-label={label}
                  type={type}
                  step={key === 'price' ? '0.01' : undefined}
                  min={type === 'number' ? (key === 'price' ? '0.01' : '1') : undefined}
                  value={fields[key]}
                  onChange={(e) => change(key, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                />
              </label>
            ))}
            <p className="text-xs text-ink-muted sm:col-span-2">
              保存只生成新草稿并使旧卡失效，不会发布活动；换商品可在聊天中提出。
            </p>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" disabled={busy || disabled}>
                保存修改，重新预览
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={close}>
                取消修改
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-red-600 sm:col-span-2">
                {error}
              </p>
            )}
          </form>
        ))}
    </div>
  );
}
