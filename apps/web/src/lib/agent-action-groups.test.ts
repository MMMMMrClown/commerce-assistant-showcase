import { describe, expect, it } from 'vitest';
import { groupActionsByTurn } from './agent-action-groups';
describe('操作卡按产生草稿的对话轮次归档', () => {
  it('修改并刷新后只展示新卡，不把已失效旧卡重复挂到同轮次', () => {
    const old = {
      id: 'old',
      runId: 'r',
      status: 'EXPIRED',
      kind: 'CREATE_SECKILL',
      payload: { proposal: {} },
    };
    const next = {
      id: 'next',
      runId: 'r',
      status: 'WAITING_CONFIRMATION',
      kind: 'CREATE_SECKILL',
      payload: { proposal: {}, replacesActionId: 'old' },
    };
    expect(groupActionsByTurn([{ reply: { runId: 'r' } }], [next, old]).byTurn).toEqual([[next]]);
    expect(
      groupActionsByTurn(
        [{ reply: { runId: 'r' } }],
        [{ ...next, status: 'SUCCEEDED', payload: { proposal: {} } }, old],
      ).byTurn[0],
    ).toHaveLength(1);
    expect(groupActionsByTurn([{ reply: { runId: 'r' } }], [old]).byTurn).toEqual([[old]]);
  });
  it('已拒绝秒杀留在原轮次，不出现在新会员回答或底部', () => {
    const card = { id: 'seckill1', runId: 'run1', status: 'REJECTED' };
    const result = groupActionsByTurn(
      [{ reply: { runId: 'run1' } }, { reply: { runId: 'run2' } }],
      [card],
    );
    expect(result.byTurn).toEqual([[card], []]);
    expect(result.unattached).toEqual([]);
  });
  it('修改草稿沿用原runId，不依赖旧草稿ID', () => {
    const revised = { id: 'new1', runId: 'run1', status: 'WAITING_CONFIRMATION' };
    const result = groupActionsByTurn(
      [
        { reply: { runId: 'run1', evidence: [{ result: { action: { id: 'old1' } } }] } },
        { reply: { runId: 'run2' } },
      ],
      [revised],
    );
    expect(result.byTurn).toEqual([[revised], []]);
  });
  it('兼容历史依据定位；无归属的已结束卡不会挂到新对话底部', () => {
    const rejected = { id: 'old1', status: 'REJECTED' };
    expect(
      groupActionsByTurn(
        [{ reply: { evidence: [{ result: { action: { id: 'old1' } } }] } }],
        [rejected],
      ).byTurn,
    ).toEqual([[rejected]]);
    expect(groupActionsByTurn([{ reply: { runId: 'new' } }], [rejected]).unattached).toEqual([]);
    const interrupted = { id: 'active1', status: 'UNKNOWN' };
    expect(groupActionsByTurn([], [interrupted]).unattached).toEqual([interrupted]);
  });
});
