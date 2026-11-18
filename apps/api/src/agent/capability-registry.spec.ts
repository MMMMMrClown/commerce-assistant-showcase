import { availableCapabilities, CAPABILITIES } from './capability-registry';
import { conversationGuide } from './capabilities';
import type { AuthUser } from '../common/api';
const user = {
  permissions: ['dashboard:view', 'order:view', 'order:cancel'],
  roles: [{ dataScope: 'ALL' }],
} as AuthUser;
describe('新增能力注册表', () => {
  it('业务工具能力名称唯一，避免模型拒绝整个工具清单', () => {
    const keys = CAPABILITIES.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('能力说明不再否认已授权的价格和会员资料编辑', () => {
    const reply = conversationGuide(
      '你能做什么',
      {
        ...user,
        permissions: [
          ...user.permissions,
          'product:view',
          'product:edit',
          'member:view',
          'member:edit',
        ],
      },
      true,
    );
    expect(reply).toContain('编辑商品资料与上下架');
    expect(reply).not.toContain('不能修改商品价格');
    expect(reply).toContain('库存和模拟履约可按已授权工具预览确认');
  });
  it('能力展示按权限裁剪，不宣传未接入的会员新增', () => {
    const list = availableCapabilities(user, true);
    expect(list.some((c) => c.key === 'prepare_cancel_order')).toBe(true);
    expect(list.some((c) => c.key === 'prepare_seckill_activity')).toBe(false);
    expect(list.some((c) => c.key === 'create_member')).toBe(false);
  });
  it('写开关关闭仍可准备卡片，但不能宣称可执行', () => {
    expect(
      availableCapabilities(user, false).find((c) => c.key === 'prepare_cancel_order')
        ?.executionEnabled,
    ).toBe(false);
  });
  it('窄范围账号不能看到个人会员工具', () => {
    expect(
      availableCapabilities(
        {
          ...user,
          permissions: [...user.permissions, 'member:view'],
          roles: [{ code: 'STORE', name: '店长', dataScope: 'STORE' }],
        },
        true,
      ).some((c) => c.key === 'search_members'),
    ).toBe(false);
  });
  it('身份介绍复用注册表，不介绍未授权的秒杀操作', () => {
    const reply = conversationGuide('你是谁', user, true);
    expect(reply).toContain('我是拾光');
    expect(reply).toContain('取消订单');
    expect(reply).not.toContain('- 发布秒杀活动');
  });
});
