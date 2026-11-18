'use client';
import { useState } from 'react';
import { Button } from './ui';
import { IMAGE_TEXT_MARKER, imageQuestionParts } from '@/lib/agent-image-text';

export function AgentImageText({
  question,
  disabled,
  onCorrect,
}: {
  question: string;
  disabled: boolean;
  onCorrect: (text: string) => void;
}) {
  const parts = imageQuestionParts(question);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(parts?.text || '');
  if (!parts) return null;
  const corrected = `${parts.prompt}\n\n${IMAGE_TEXT_MARKER}\n${text.trim()}`;
  return (
    <details className="mt-2 text-xs text-ink-muted">
      <summary className="cursor-pointer">图片识别内容 · 识别有误可修改</summary>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            aria-label="修改图片识别文字"
            rows={5}
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink"
          />
          <p>请核对姓名、编号和金额。填入下方输入框后，点击发送重新提问。</p>
          {corrected.length > 2000 && <p role="alert">合计超过2000字，请缩短内容。</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={disabled || !text.trim() || corrected.length > 2000}
              onClick={() => {
                onCorrect(corrected);
                setEditing(false);
              }}
            >
              填入输入框
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(parts.text);
                setEditing(false);
              }}
            >
              取消修改
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 whitespace-pre-wrap">{parts.text}</p>
          <button
            type="button"
            className="mt-2 underline"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            修改识别文字
          </button>
        </>
      )}
    </details>
  );
}
