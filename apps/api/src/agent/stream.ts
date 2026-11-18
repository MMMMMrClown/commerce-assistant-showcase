// 【流式协议】跨网络分块保留SSE残片，聚合工具参数；只向客户端转发正文delta。
export async function readModelStream(response: Response, emit: (text: string) => void) {
  if (!response.body) throw new Error('模型未返回流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    content = '';
  const calls = new Map<
    number,
    { id: string; type: 'function'; function: { name: string; arguments: string } }
  >();
  let finished = false;
  const consume = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    if (!data) return;
    const packet = JSON.parse(data) as {
      error?: unknown;
      choices?: {
        finish_reason?: string;
        delta?: {
          content?: string;
          tool_calls?: {
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
    };
    if (packet.error) throw new Error('模型流返回错误');
    const choice = packet.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('模型输出达到长度上限，请缩小问题范围');
    const delta = choice?.delta;
    if (delta?.content) {
      content += delta.content;
      emit(delta.content);
    }
    for (const call of delta?.tool_calls || []) {
      const item = calls.get(call.index) || {
        id: '',
        type: 'function' as const,
        function: { name: '', arguments: '' },
      };
      if (call.id) item.id = call.id;
      item.function.name += call.function?.name || '';
      item.function.arguments += call.function?.arguments || '';
      calls.set(call.index, item);
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consume(line.trimEnd());
      if (chunk.done) {
        if (buffer) consume(buffer);
        break;
      }
    }
    if (!finished) throw new Error('模型连接中断，回答未完成');
    return {
      role: 'assistant',
      content,
      ...(calls.size ? { tool_calls: [...calls.values()] } : {}),
    };
  } finally {
    reader.releaseLock();
  }
}
