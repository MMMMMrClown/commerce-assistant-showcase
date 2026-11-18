import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentPet } from './agent-pet';
const state = vi.hoisted(() => ({
  path: '/orders',
  user: { id: 'pet-test', permissions: ['dashboard:view'] },
}));
vi.mock('next/navigation', () => ({ usePathname: () => state.path }));
vi.mock('@/store/store', () => ({
  useAppSelector: (fn: (s: unknown) => unknown) => fn({ auth: { user: state.user } }),
}));
vi.mock('next/dynamic', () => ({ default: () => () => <textarea aria-label="复用助手输入框" /> }));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  state.path = '/orders';
  state.user = { id: 'pet-test', permissions: ['dashboard:view'] };
});
it('点击打开复用助手小窗，收起、关闭和恢复不丢失本地偏好', () => {
  render(<AgentPet />);
  fireEvent.click(screen.getByLabelText('与拾光快捷对话，可拖动移动'));
  expect(screen.getByLabelText('复用助手输入框')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('关闭闲聊气泡'));
  fireEvent.click(screen.getByLabelText('收起快捷对话'));
  fireEvent.click(screen.getByLabelText('关闭页面宠物'));
  expect(JSON.parse(localStorage.getItem('retail:pet:v1:pet-test')!).hidden).toBe(true);
  fireEvent.click(screen.getByLabelText('恢复拾光页面宠物'));
  expect(screen.getByLabelText('恢复贴边的拾光')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('retail:pet:v1:pet-test')!).quiet).toBe(true);
});
it('拖动到边侧不会误开聊天，刷新后保持贴边并可恢复', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => true;
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  const view = render(<AgentPet />);
  const pet = screen.getByLabelText('与拾光快捷对话，可拖动移动');
  fireEvent.pointerDown(pet, { clientX: 900, clientY: 600, button: 0 });
  fireEvent.pointerMove(pet, { clientX: 0, clientY: 400, button: 0 });
  fireEvent.pointerUp(pet, { clientX: 0, clientY: 400, button: 0 });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('恢复贴边的拾光')).toBeInTheDocument();
  view.unmount();
  render(<AgentPet />);
  fireEvent.click(screen.getByLabelText('恢复贴边的拾光'));
  expect(screen.getByLabelText('与拾光快捷对话，可拖动移动')).toBeInTheDocument();
});
it('账号隔离，损坏的位置不越界；完整助手页和无权限账号不重复显示', () => {
  localStorage.setItem('retail:pet:v1:someone-else', JSON.stringify({ hidden: true }));
  localStorage.setItem('retail:pet:v1:pet-test', JSON.stringify({ x: -1000, y: 99999 }));
  const view = render(<AgentPet />);
  const saved = JSON.parse(localStorage.getItem('retail:pet:v1:pet-test')!);
  expect(saved.x).toBe(0);
  expect(saved.y).toBeLessThan(innerHeight);
  state.path = '/agent';
  view.rerender(<AgentPet />);
  expect(screen.queryByLabelText('与拾光快捷对话，可拖动移动')).not.toBeInTheDocument();
  state.path = '/orders';
  state.user.permissions = [];
  view.rerender(<AgentPet />);
  expect(screen.queryByLabelText('与拾光快捷对话，可拖动移动')).not.toBeInTheDocument();
});
it('业务弹窗打开时让开操作区域', async () => {
  render(<AgentPet />);
  const modal = document.createElement('section');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  document.body.appendChild(modal);
  await waitFor(() =>
    expect(screen.queryByLabelText('与拾光快捷对话，可拖动移动')).not.toBeInTheDocument(),
  );
  modal.remove();
  await waitFor(() =>
    expect(screen.getByLabelText('与拾光快捷对话，可拖动移动')).toBeInTheDocument(),
  );
});
