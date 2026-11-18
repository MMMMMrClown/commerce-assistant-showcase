import {
  batchOperationsSchema,
  generatedMembersSchema,
  selectBatchMembers,
  selectBatchProducts,
} from './batch-operations';
import { availableCapabilities } from './capability-registry';
import type { AuthUser } from '../common/api';
import type { MemberState } from './member-tools';
import type { PrismaService } from '../prisma/prisma.service';
const user = {
  permissions: ['dashboard:view', 'member:view', 'product:view'],
  roles: [{ code: 'ADMIN', name: '管理者', dataScope: 'ALL' }],
} as AuthUser;
it('人数由参数决定，批量不能把任意字段传给业务Service', () => {
  expect(generatedMembersSchema.parse({ count: 5 }).count).toBe(5);
  expect(generatedMembersSchema.parse({ count: 12 }).count).toBe(12);
  expect(() =>
    batchOperationsSchema.parse({
      title: '修改库存',
      items: [
        {
          operation: 'PRODUCT_STOCK',
          input: { productId: 'p', mode: 'ADD', quantity: 5, reason: '补货', stockReserved: 0 },
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    batchOperationsSchema.parse({
      title: '改积分',
      items: [{ operation: 'MEMBER_EDIT', input: { memberId: 'm', changes: { points: 999 } } }],
    }),
  ).toThrow();
});
it('同名会员不能静默选中，并清除之前选人结果，防止误用旧集合', async () => {
  const state: MemberState = {
    memberSelection: { id: 'old', members: [{ id: 'old', name: '旧会员', maskedPhone: '***' }] },
  };
  const db = {
    member: {
      findMany: () =>
        Promise.resolve([
          { id: 'm1', name: '同名', phone: '19900000001' },
          { id: 'm2', name: '同名', phone: '19900000002' },
        ]),
    },
  } as unknown as PrismaService;
  await expect(
    selectBatchMembers(db, user, { mode: 'EXPLICIT', names: ['同名'] }, state),
  ).rejects.toThrow('同名');
  expect(state.memberSelection).toBeUndefined();
});
it('同名商品必须消歧，不能静默扩充指定对象', async () => {
  const db = {
    product: {
      findMany: () =>
        Promise.resolve([
          { id: 'p1', name: '杯子', code: 'P1' },
          { id: 'p2', name: '杯子', code: 'P2' },
        ]),
    },
  } as unknown as PrismaService;
  await expect(selectBatchProducts(db, user, { names: ['杯子'] }, {})).rejects.toThrow('同名商品');
});
it('窄范围账号看不到批量全平台能力，权限不足不能选人', async () => {
  const narrow = {
    ...user,
    roles: [{ code: 'STORE', name: '门店', dataScope: 'STORE' }],
  } as AuthUser;
  expect(
    availableCapabilities(narrow, true).some((c) => c.key === 'prepare_batch_operations'),
  ).toBe(false);
  await expect(
    selectBatchMembers(
      {} as PrismaService,
      { ...user, permissions: ['dashboard:view'] },
      { mode: 'RANDOM', count: 5 },
      {},
    ),
  ).rejects.toThrow('member:view');
});
