import { readModelStream } from './stream';

function response(parts: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
  );
}
describe('模型SSE流', () => {
  it('跨分块解析正文并立即转发delta', async () => {
    const emit = jest.fn();
    const packet =
      'data: {"choices":[{"delta":{"content":"营业额"}}]}\n\ndata: {"choices":[{"delta":{"content":"123元"}}]}\n\ndata: [DONE]\n\n';
    const reply = await readModelStream(
      response([packet.slice(0, 16), packet.slice(16, 63), packet.slice(63)]),
      emit,
    );
    expect(reply.content).toBe('营业额123元');
    expect(emit.mock.calls).toEqual([['营业额'], ['123元']]);
  });
  it('聚合工具调用参数片段', async () => {
    const packets = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'c1',
                  function: { name: 'query_sales_summary', arguments: '{"days":' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '7}' } }] } }] },
    ];
    const reply = await readModelStream(
      response(
        packets.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').concat('data: [DONE]\n\n'),
      ),
      jest.fn(),
    );
    expect(reply.tool_calls?.[0].function.arguments).toBe('{"days":7}');
  });
  it('连接提前结束不能伪装完成', async () => {
    await expect(
      readModelStream(
        response(['data: {"choices":[{"delta":{"content":"部分"}}]}\n\n']),
        jest.fn(),
      ),
    ).rejects.toThrow('连接中断');
  });
});
