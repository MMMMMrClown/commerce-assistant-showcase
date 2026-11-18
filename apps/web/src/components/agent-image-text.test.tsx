import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentImageText } from './agent-image-text';
import { IMAGE_TEXT_MARKER } from '@/lib/agent-image-text';

afterEach(cleanup);
it('识别姓名改正后只填回输入框，不自动发送也不修改原记录', () => {
  const corrected = vi.fn();
  const question = `帮我查看这个会员的近期订单\n\n${IMAGE_TEXT_MARKER}\n会员姓名：邓正宁`;
  render(<AgentImageText question={question} disabled={false} onCorrect={corrected} />);
  fireEvent.click(screen.getByText('图片识别内容 · 识别有误可修改'));
  fireEvent.click(screen.getByRole('button', { name: '修改识别文字' }));
  fireEvent.change(screen.getByRole('textbox', { name: '修改图片识别文字' }), {
    target: { value: '会员姓名：邓芷宁' },
  });
  fireEvent.click(screen.getByRole('button', { name: '填入输入框' }));
  expect(corrected).toHaveBeenCalledExactlyOnceWith(
    `帮我查看这个会员的近期订单\n\n${IMAGE_TEXT_MARKER}\n会员姓名：邓芷宁`,
  );
  expect(screen.getByText('会员姓名：邓正宁')).toBeInTheDocument();
});
it('历史只有识别文本也能修改，取消时保留原文且不回填', () => {
  const corrected = vi.fn();
  render(
    <AgentImageText
      question={`查询\n\n${IMAGE_TEXT_MARKER}\n邓正宁`}
      disabled={false}
      onCorrect={corrected}
    />,
  );
  fireEvent.click(screen.getByText('图片识别内容 · 识别有误可修改'));
  fireEvent.click(screen.getByRole('button', { name: '修改识别文字' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '邓芷宁' } });
  fireEvent.click(screen.getByRole('button', { name: '取消修改' }));
  expect(corrected).not.toHaveBeenCalled();
  expect(screen.getByText('邓正宁')).toBeInTheDocument();
});
