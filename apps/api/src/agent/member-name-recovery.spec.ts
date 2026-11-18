import type { AuthUser } from '../common/api';
import type { MembersService } from '../members/members.service';
import type { OrdersService } from '../orders/orders.service';
import { MemberTools, type MemberState } from './member-tools';

const user = {
  id: 'u',
  permissions: ['member:view', 'order:view'],
  roles: [{ dataScope: 'ALL' }],
} as AuthUser;
const member = (name: string, id = name) => ({ id, name, phone: '19900001234', enabled: true });
function setup(rows = [member('邓芷宁')], total = rows.length) {
  const list = jest.fn((query: Record<string, string>) =>
    Promise.resolve({
      items: query.keyword === '邓正宁' || query.keyword === '19900009999' ? [] : rows,
      total: query.keyword === '邓正宁' || query.keyword === '19900009999' ? 0 : total,
    }),
  );
  const orders = { list: jest.fn().mockResolvedValue({ items: [] }) };
  const members = { list, detail: jest.fn().mockResolvedValue(member('邓芷宁')) };
  return {
    tools: new MemberTools(
      members as unknown as MembersService,
      orders as unknown as OrdersService,
    ),
    list,
    orders,
  };
}
it('邓正宁未找到时只提供邓芷宁真实候选，仍须点选，不能直接读订单', async () => {
  const { tools, orders } = setup();
  const state: MemberState = { selectedMemberId: 'previous' };
  const result = await tools.search(user, { keyword: '邓正宁', match: 'NAME' }, state);
  expect(result).toMatchObject({
    matchQuality: 'SIMILAR_NAME',
    selectionRequired: true,
    candidates: [{ name: '邓芷宁', maskedPhone: '199****1234' }],
  });
  expect(state.selectedMemberId).toBeUndefined();
  expect(state.candidateIds).toEqual(['邓芷宁']);
  expect(await tools.listOrders(user, { memberId: '邓芷宁' }, state)).toMatchObject({
    code: 'MEMBER_SELECTION_REQUIRED',
  });
  expect(orders.list).not.toHaveBeenCalled();
});
it('只取同姓等长且恰好一字不同，多个候选不自动选人', async () => {
  const { tools } = setup([
    member('邓芷宁'),
    member('邓志宁'),
    member('王正宁'),
    member('邓某某'),
    member('邓正宁甲'),
  ]);
  const state: MemberState = {};
  const result = await tools.search(user, { keyword: '邓正宁', match: 'NAME' }, state);
  expect('candidates' in result && result.candidates?.map((item) => item.name)).toEqual([
    '邓芷宁',
    '邓志宁',
  ]);
  expect(state.selectedMemberId).toBeUndefined();
});
it('已有姓名命中不启动相近查询，完整手机号查不到也不猜姓名', async () => {
  const { tools, list } = setup();
  await tools.search(user, { keyword: '邓芷宁', match: 'NAME' }, {});
  expect(list).toHaveBeenCalledTimes(1);
  list.mockClear();
  const result = await tools.search(user, { keyword: '19900009999', match: 'PHONE_EXACT' }, {});
  expect(result).toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  expect(list).toHaveBeenCalledTimes(1);
});
it('保留权限边界，拒绝受限账号且不执行姓名查询', async () => {
  const { tools, list } = setup();
  await expect(
    tools.search(
      { ...user, roles: [{ dataScope: 'STORE' }] } as AuthUser,
      { keyword: '邓正宁', match: 'NAME' },
      {},
    ),
  ).rejects.toThrow('不能查询');
  expect(list).not.toHaveBeenCalled();
});
it('同姓扫描有上限，不能无限扫描或把结果当作已自动确认', async () => {
  const { tools, list } = setup([member('邓芷宁')], 10000);
  const state: MemberState = {};
  const result = await tools.search(user, { keyword: '邓正宁', match: 'NAME' }, state);
  expect(list).toHaveBeenCalledTimes(4);
  expect(result).toMatchObject({ truncated: true, selectionRequired: true });
  expect(state.selectedMemberId).toBeUndefined();
});
