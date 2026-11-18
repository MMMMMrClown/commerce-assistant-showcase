/* oxlint-disable react/only-export-components -- Next.js pages colocate metadata with the component. */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { loadAuthenticatedUser } from '@/lib/api-server';
import ProfileView from '@/views/profile';

export const metadata: Metadata = {
  title: '个人中心',
  description: '查看当前账号、角色和数据权限',
};

export default async function ProfilePage() {
  const currentUser = await loadAuthenticatedUser();
  if (!currentUser) redirect('/login');
  return <ProfileView currentUser={currentUser} />;
}
