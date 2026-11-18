import { ConfigService } from '@nestjs/config';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { MediaInputService, mediaKind } from './media-input';

function image() {
  return {
    buffer: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
    mimetype: 'image/png',
  } as Express.Multer.File;
}
function audio(seconds = 1) {
  const b = Buffer.alloc(44 + seconds * 32000);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(b.length - 44, 40);
  return { buffer: b, mimetype: 'audio/wav' } as Express.Multer.File;
}
function settings(key = 'synthetic-media-key') {
  return new ConfigService({
    AGENT_MEDIA_API_KEY: key,
    AGENT_MEDIA_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
}
function response(text: string, finish = 'stop') {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'private reasoning', content: text }, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
  );
}
afterEach(() => jest.restoreAllMocks());

it('伪装文件、空文件、超大文件在请求模型前拒绝', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch');
  const service = new MediaInputService(settings());
  for (const file of [
    undefined,
    { ...image(), buffer: Buffer.from('<svg>bad</svg>') },
    { ...image(), buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
  ])
    await expect(service.recognize('u', file)).rejects.toBeInstanceOf(BadRequestException);
  expect(fetcher).not.toHaveBeenCalled();
});
it('仅接受有效长度和格式的PCM录音，不按文件扩展名信任内容', () => {
  expect(mediaKind(audio())).toBe('audio');
  expect(() => mediaKind(audio(61))).toThrow(BadRequestException);
  const wrongRate = audio();
  wrongRate.buffer.writeUInt32LE(48000, 24);
  expect(() => mediaKind(wrongRate)).toThrow(BadRequestException);
});
it('图片只转文字，没有工具调用、业务写入或私有推理输出', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response('订单号TEST-123'));
  const result = await new MediaInputService(settings()).recognize('u', image());
  expect(result).toEqual({ kind: 'image', model: 'qwen3.8-omni-flash', text: '订单号TEST-123' });
  const request = JSON.parse(fetcher.mock.calls[0][1]?.body as string) as {
    model: string;
    tools?: unknown;
    messages: unknown[];
    enable_thinking: boolean;
  };
  expect(request.model).toBe('qwen3.8-omni-flash');
  expect(request.tools).toBeUndefined();
  expect(request.enable_thinking).toBe(false);
  expect(JSON.stringify(request.messages)).toContain('data:image/png;base64,');
});
it('语音按WAV输入并保留转写文字，不自动提交聊天或执行', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response('查询最近七天销售'));
  expect((await new MediaInputService(settings()).recognize('u', audio())).text).toBe(
    '查询最近七天销售',
  );
  expect(fetcher.mock.calls[0][1]?.body).toContain('input_audio');
  expect(fetcher.mock.calls[0][1]?.body).toContain('data:audio/wav;base64,');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('截断、空语音和过长结果不会作为完整指令交给Agent', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch');
  const service = new MediaInputService(settings());
  fetcher.mockResolvedValueOnce(response('不完整命令', 'length'));
  await expect(service.recognize('u', image())).rejects.toBeInstanceOf(ServiceUnavailableException);
  fetcher.mockResolvedValueOnce(response('[无法识别]'));
  await expect(service.recognize('u', audio())).rejects.toBeInstanceOf(BadRequestException);
  fetcher.mockResolvedValueOnce(response('字'.repeat(1401)));
  await expect(service.recognize('u', image())).rejects.toBeInstanceOf(BadRequestException);
});
it('缺少专用密钥或上游报错不回显密钥及原始服务响应', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch');
  await expect(new MediaInputService(settings('')).recognize('u', image())).rejects.toThrow(
    '尚未配置',
  );
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response('sensitive upstream details', { status: 403 }));
  await expect(new MediaInputService(settings()).recognize('u', image())).rejects.toThrow(
    '未获授权',
  );
});
it('同一账号并发识别受控拒绝，结束后释放占用', async () => {
  let finish!: (value: Response) => void;
  jest.spyOn(globalThis, 'fetch').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const service = new MediaInputService(settings());
  const first = service.recognize('u', image());
  await expect(service.recognize('u', image())).rejects.toMatchObject({ status: 429 });
  finish(response('完成'));
  await first;
  jest.mocked(fetch).mockResolvedValueOnce(response('再次完成'));
  expect((await service.recognize('u', image())).text).toBe('再次完成');
});
