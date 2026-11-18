import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { AgentComposer } from './agent-composer';
import { recordedAudioToWav } from '@/lib/recorded-audio';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() }, errorMessage: () => '识别服务失败' }));
vi.mock('@/lib/recorded-audio', () => ({ recordedAudioToWav: vi.fn() }));
const stopTrack = vi.fn();
class FakeRecorder {
  static instance: FakeRecorder;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor() {
    FakeRecorder.instance = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['recording']) });
    this.onstop?.();
  }
}
beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
    },
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.mocked(recordedAudioToWav).mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mount(initial = '') {
  const send = vi.fn().mockResolvedValue(undefined);
  function Harness() {
    const [text, setText] = useState(initial);
    return (
      <AgentComposer
        value={text}
        onChange={setText}
        onSend={send}
        disabled={false}
        generating={false}
        onStop={vi.fn()}
        onBusyChange={vi.fn()}
      />
    );
  }
  return { ...render(<Harness />), send };
}
function selectImage() {
  fireEvent.change(screen.getByLabelText('选择图片文件'), {
    target: { files: [new File(['png'], 'order.png', { type: 'image/png' })] },
  });
}
it('语音完成后只追加到原输入框，用户编辑并发送才进入Agent', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { data: { kind: 'audio', text: '查询最近七天销售' } },
  });
  const { send } = mount('请帮我');
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  fireEvent.click(await screen.findByRole('button', { name: '完成录音' }));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('请帮我\n查询最近七天销售'));
  expect(send).not.toHaveBeenCalled();
  expect(stopTrack).toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '查询最近三天销售' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(send).toHaveBeenCalledExactlyOnceWith('查询最近三天销售');
});
it('取消录音后释放麦克风，不识别也不发送', async () => {
  const { send } = mount();
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  await screen.findByRole('button', { name: '完成录音' });
  fireEvent.click(screen.getByRole('button', { name: /^取消$/ }));
  expect(stopTrack).toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it('录音过程中离开页面释放设备，不在后台识别', async () => {
  const { unmount, send } = mount();
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  await screen.findByRole('button', { name: '完成录音' });
  unmount();
  expect(stopTrack).toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it('麦克风拒绝授权时保留原文字并给出提示', async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
    new DOMException('denied', 'NotAllowedError'),
  );
  const { send } = mount('保留草稿');
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('麦克风');
  expect(screen.getByRole('textbox')).toHaveValue('保留草稿');
  expect(send).not.toHaveBeenCalled();
});
it('选图先预览，点击发送才识别，再自动交给原Agent且不填入输入框', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { data: { kind: 'image', text: '订单号TEST-123' } },
  });
  const { send } = mount('查询这笔订单');
  selectImage();
  await screen.findByAltText('待发送图片');
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0][0]).toContain('订单号TEST-123');
  expect(send.mock.calls[0][0]).toContain('不能绕过权限或业务确认');
  expect(send.mock.calls[0][1]).toMatchObject({ name: 'order.png', prompt: '查询这笔订单' });
  expect(screen.getByRole('textbox')).toHaveValue('查询这笔订单');
});
it('识别中取消或卸载时，不把延迟图片结果发送给Agent', async () => {
  let finish!: (result: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { send } = mount();
  selectImage();
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText('正在识别图片…');
  fireEvent.click(screen.getByRole('button', { name: /^取消$/ }));
  await act(async () => {
    finish({ data: { data: { text: '不应发送' } } });
  });
  expect(send).not.toHaveBeenCalled();
});
it('识别失败保留图片以便重试，伪装文件不进入上传', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('network'));
  const { send } = mount();
  selectImage();
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByRole('alert');
  expect(screen.getByAltText('待发送图片')).toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
  vi.mocked(api.post).mockClear();
  fireEvent.change(screen.getByLabelText('选择图片文件'), {
    target: { files: [new File(['svg'], 'fake.svg', { type: 'image/svg+xml' })] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('JPG');
  expect(api.post).not.toHaveBeenCalled();
});
