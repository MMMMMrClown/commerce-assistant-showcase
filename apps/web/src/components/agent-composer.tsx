'use client';
import Image from 'next/image';
import { ImagePlus, Mic, Send, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import { recordedAudioToWav } from '@/lib/recorded-audio';
import { Button } from '@/components/ui';
import { IMAGE_TEXT_MARKER } from '@/lib/agent-image-text';

export type SentImage = { url: string; name: string; prompt: string };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string, image?: SentImage) => Promise<void>;
  disabled: boolean;
  generating: boolean;
  onStop: () => void;
  onBusyChange: (busy: boolean) => void;
  compact?: boolean;
  children?: ReactNode;
};

export function AgentComposer({
  value,
  onChange,
  onSend,
  disabled,
  generating,
  onStop,
  onBusyChange,
  compact,
  children,
}: Props) {
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [phase, setPhase] = useState<'permission' | 'recording' | 'recognizing' | 'image' | null>(
    null,
  );
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const working = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    onBusyChange(phase !== null);
    return () => onBusyChange(false);
  }, [phase, onBusyChange]);
  useEffect(() => {
    if (!image) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  function releaseMicrophone() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      releaseMicrophone();
    },
    [],
  );

  function chooseImage(file?: File) {
    if (!file || disabled || working.current) return;
    setError('');
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError('请选择不超过5MB的JPG、PNG或WebP图片');
      return;
    }
    setImage(file);
  }
  async function recognize(file: File, signal: AbortSignal) {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<{ data: { text: string; kind: string } }>(
      '/agent/media/recognize',
      form,
      { signal, timeout: 40000 },
    );
    return data.data.text;
  }
  function cancel() {
    generation.current++;
    controller.current?.abort();
    if (recorder.current?.state === 'recording') recorder.current.stop();
    releaseMicrophone();
    working.current = false;
    setPhase(null);
    setError('');
  }
  async function startVoice() {
    if (disabled || working.current) return;
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('当前浏览器无法录音，请使用HTTPS或本机localhost，并允许麦克风权限');
      return;
    }
    working.current = true;
    setPhase('permission');
    setSeconds(0);
    const token = ++generation.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== generation.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const recording = new MediaRecorder(media);
      recorder.current = recording;
      const chunks: Blob[] = [];
      recording.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recording.onerror = () => {
        if (token === generation.current) {
          cancel();
          setError('录音失败，请重试');
        }
      };
      recording.onstop = () => {
        if (token !== generation.current) return;
        releaseMicrophone();
        setPhase('recognizing');
        const abort = new AbortController();
        controller.current = abort;
        void (async () => {
          try {
            const wav = await recordedAudioToWav(new Blob(chunks, { type: recording.mimeType }));
            if (token !== generation.current) return;
            const text = await recognize(
              new File([wav], 'recording.wav', { type: 'audio/wav' }),
              abort.signal,
            );
            if (token !== generation.current) return;
            const next = [valueRef.current.trim(), text.trim()].filter(Boolean).join('\n');
            if (next.length > 2000)
              throw new Error('识别结果与输入内容合计超过2000字，请缩短语音后重试');
            onChange(next);
            input.current?.focus();
          } catch (err) {
            if (token === generation.current)
              setError(
                err instanceof Error && !('isAxiosError' in err) ? err.message : errorMessage(err),
              );
          } finally {
            if (token === generation.current) {
              working.current = false;
              setPhase(null);
            }
          }
        })();
      };
      recording.start();
      setPhase('recording');
      const began = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - began) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 60 && recording.state === 'recording') recording.stop();
      }, 250);
    } catch {
      if (token === generation.current) {
        releaseMicrophone();
        working.current = false;
        setPhase(null);
        setError('无法使用麦克风，请检查浏览器授权和设备连接后重试');
      }
    }
  }
  async function send() {
    if (disabled || working.current || (!value.trim() && !image)) return;
    setError('');
    if (!image) {
      await onSend(value.trim());
      return;
    }
    working.current = true;
    setPhase('image');
    const token = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const text = await recognize(image, abort.signal);
      if (token !== generation.current) return;
      const question = `${value.trim() || '请根据图片内容理解我的问题；业务对象或意图不明确时先询问。'}\n\n${IMAGE_TEXT_MARKER}\n${text}`;
      if (question.length > 2000)
        throw new Error('图片内容与问题合计超过2000字，请裁剪图片或缩短问题');
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(image);
      });
      if (token !== generation.current) return;
      setPhase(null);
      working.current = false;
      await onSend(question, { url, name: image.name, prompt: value.trim() });
      if (token === generation.current) setImage(null);
    } catch (err) {
      if (token === generation.current)
        setError(
          err instanceof Error && !('isAxiosError' in err) ? err.message : errorMessage(err),
        );
    } finally {
      if (token === generation.current) {
        working.current = false;
        setPhase(null);
      }
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="mx-auto max-w-3xl rounded-2xl border border-line bg-sunken p-3 focus-within:border-orange-400 dark:bg-surface"
    >
      {children}
      {image && preview && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-line p-2">
          <Image
            unoptimized
            src={preview}
            width={64}
            height={64}
            alt="待发送图片"
            className="h-16 w-16 rounded-lg object-contain"
          />
          <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{image.name}</span>
          <button
            type="button"
            aria-label="移除图片"
            disabled={disabled || !!phase}
            onClick={() => setImage(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {phase && (
        <div
          className="mb-2 flex items-center gap-3 rounded-xl border border-line px-3 py-2"
          role="status"
        >
          <Mic
            size={18}
            className={phase === 'recording' ? 'animate-pulse text-brand' : 'text-ink-muted'}
          />
          <span className="flex-1 text-sm">
            {phase === 'recording'
              ? `正在录音 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
              : phase === 'permission'
                ? '正在等待麦克风授权…'
                : phase === 'image'
                  ? '正在识别图片…'
                  : '正在转成文字…'}
          </span>
          <button type="button" className="text-xs text-ink-muted" onClick={cancel}>
            取消
          </button>
          {phase === 'recording' && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (recorder.current?.state === 'recording') recorder.current.stop();
              }}
            >
              完成录音
            </Button>
          )}
        </div>
      )}
      <textarea
        ref={input}
        autoFocus={compact}
        aria-label="向拾光提问"
        placeholder="向拾光提问，也可以添加图片或使用语音输入"
        rows={2}
        maxLength={2000}
        readOnly={phase === 'image'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={(event) => {
          const file = Array.from(event.clipboardData.files).find((item) =>
            item.type.startsWith('image/'),
          );
          if (file) {
            event.preventDefault();
            chooseImage(file);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
        className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-7 outline-none"
      />
      {error && (
        <p role="alert" className="mb-2 px-2 text-sm text-brick">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="添加图片"
            title="添加图片"
            disabled={disabled || !!phase}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={18} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="语音输入"
            title="语音输入"
            disabled={disabled || !!phase}
            onClick={() => void startVoice()}
          >
            <Mic size={18} />
          </Button>
          <span className="hidden text-xs text-ink-faint sm:inline">
            Enter 发送 · Shift+Enter 换行
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="选择图片文件"
            className="hidden"
            onChange={(event) => {
              chooseImage(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        {generating ? (
          <Button type="button" size="sm" variant="outline" onClick={onStop}>
            <Square size={13} />
            停止生成
          </Button>
        ) : (
          <Button size="sm" disabled={disabled || !!phase || (!value.trim() && !image)}>
            <Send size={14} />
            发送
          </Button>
        )}
      </div>
      {phase === 'recording' && (
        <p className="mt-2 px-2 text-xs text-ink-muted">
          完成后文字填入输入框，点击发送才会提问；最长60秒。
        </p>
      )}
    </form>
  );
}
