import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApi } from './use-api';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../lib/api', () => ({
  api: { get },
  errorMessage: () => '请求失败',
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type Response = { data: { data: string[] } };

describe('搜索请求更新', () => {
  beforeEach(() => get.mockReset());
  afterEach(cleanup);

  it('清空关键字后，较晚返回的旧搜索结果不会覆盖全部数据', async () => {
    const oldSearch = deferred<Response>();
    const allMembers = deferred<Response>();
    get.mockReturnValueOnce(oldSearch.promise).mockReturnValueOnce(allMembers.promise);

    const { result, rerender } = renderHook(({ url }) => useApi<string[]>(url), {
      initialProps: { url: '/members?keyword=测试' },
    });
    rerender({ url: '/members?keyword=' });

    await act(async () => {
      allMembers.resolve({ data: { data: ['会员甲', '会员乙'] } });
    });
    expect(result.current.data).toEqual(['会员甲', '会员乙']);

    await act(async () => {
      oldSearch.resolve({ data: { data: ['会员甲'] } });
    });
    expect(result.current.data).toEqual(['会员甲', '会员乙']);
    expect(result.current.loading).toBe(false);
  });

  it('旧请求失败不会显示错误或提前结束新请求的加载状态', async () => {
    const oldSearch = deferred<Response>();
    const newSearch = deferred<Response>();
    get.mockReturnValueOnce(oldSearch.promise).mockReturnValueOnce(newSearch.promise);

    const { result, rerender } = renderHook(({ url }) => useApi<string[]>(url), {
      initialProps: { url: '/members?keyword=甲' },
    });
    rerender({ url: '/members?keyword=乙' });

    await act(async () => {
      oldSearch.reject(new Error('旧请求失败'));
    });
    expect(result.current.error).toBe('');
    expect(result.current.loading).toBe(true);

    await act(async () => {
      newSearch.resolve({ data: { data: ['会员乙'] } });
    });
    expect(result.current.data).toEqual(['会员乙']);
    expect(result.current.loading).toBe(false);
  });
});
