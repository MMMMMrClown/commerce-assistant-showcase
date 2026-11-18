import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentImportAttachment } from './agent-import-attachment';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({ api: { post: vi.fn() }, errorMessage: () => '上传失败' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('聊天CSV附件', () => {
  it('上传只做预校验，将可信任务编号填写到输入框，不确认导入', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        data: {
          id: 'import1',
          fileName: 'orders.csv',
          totalRows: 2,
          successRows: 2,
          failedRows: 0,
        },
      },
    });
    const prompt = vi.fn();
    render(<AgentImportAttachment disabled={false} onPrompt={prompt} />);
    fireEvent.change(screen.getByLabelText('附加订单CSV文件'), {
      target: { files: [new File(['orderNo'], 'orders.csv', { type: 'text/csv' })] },
    });
    await waitFor(() => expect(prompt).toHaveBeenCalledWith(expect.stringContaining('import1')));
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/data-imports/upload', expect.any(FormData));
    expect(screen.getByRole('status')).toHaveTextContent('尚未导入订单');
  });
  it('拒绝非CSV附件，避免将任意文件当作订单数据', () => {
    render(<AgentImportAttachment disabled={false} onPrompt={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('附加订单CSV文件'), {
      target: { files: [new File(['x'], 'orders.pdf')] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('CSV');
    expect(api.post).not.toHaveBeenCalled();
  });
});
