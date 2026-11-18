'use client';

import { ShoppingBasket, KeyRound, Mail, MapPin, ShieldCheck, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, errorMessage } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '../components/ui';
import type { AuthUser } from '../store/store';
const schema = z
  .object({
    currentPassword: z.string().min(1, '请输入当前密码'),
    newPassword: z.string().min(8, '新密码至少 8 位'),
    confirmPassword: z.string().min(1, '请确认新密码'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: '两次输入的新密码不一致',
  });
type PasswordForm = z.infer<typeof schema>;
export default function ProfileView({ currentUser: u }: { currentUser: AuthUser }) {
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForm>({ resolver: zodResolver(schema) });
  const submit = handleSubmit(async (values) => {
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      reset();
      toast({ title: '密码修改成功', variant: 'success' });
    } catch (e) {
      toast({ title: '密码修改失败', description: errorMessage(e), variant: 'error' });
    }
  });
  return (
    <>
      <PageHeader title="个人中心" description="查看当前账号、角色和数据权限" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-1">
          <div className="h-28 bg-gradient-to-br from-orange-600 to-orange-400" />
          <div className="px-6 pb-6 text-center">
            <div className="mx-auto -mt-10 grid h-20 w-20 place-items-center rounded-full border-4 border-white bg-orange-100 text-orange-800 dark:border-stone-900">
              <UserRound size={34} />
            </div>
            <h2 className="mt-3 text-xl font-bold">{u.name}</h2>
            <p className="text-sm text-ink-faint">@{u.username}</p>
            <div className="mt-4 flex justify-center gap-2">
              {u.roles.map((r) => (
                <Badge key={r.code} tone="amber">
                  {r.name}
                </Badge>
              ))}
            </div>
          </div>
        </Card>
        <Card className="p-6 lg:col-span-2">
          <Tabs defaultValue="account">
            <TabsList>
              <TabsTrigger value="account">账号信息</TabsTrigger>
              <TabsTrigger value="password">修改密码</TabsTrigger>
            </TabsList>
            <TabsContent value="account">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  [Mail, '登录账号', u.username],
                  [ShieldCheck, '权限数量', `${u.permissions.length} 项`],
                  [
                    MapPin,
                    '数据范围',
                    u.storeId ? '所属门店' : u.regionId ? '所属区域' : '全部数据',
                  ],
                  [KeyRound, '认证方式', 'HttpOnly Session Cookie'],
                ].map(([Icon, label, value], i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 rounded-xl bg-sunken p-4 dark:bg-sunken"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-md bg-surface text-orange-700 shadow-sm">
                      <Icon size={19} />
                    </div>
                    <div>
                      <div className="text-xs text-ink-faint">{label as string}</div>
                      <div className="mt-1 font-medium">{value as string}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900 dark:bg-orange-950 dark:text-orange-300">
                <div className="flex items-center gap-2 font-semibold">
                  <ShoppingBasket size={17} />
                  零售电商教学账号
                </div>
                <p className="mt-1 opacity-80">生产环境应使用更强密码，并合理设置会话有效期。</p>
              </div>
            </TabsContent>
            <TabsContent value="password">
              <form onSubmit={submit} className="max-w-md space-y-4">
                {[
                  ['currentPassword', '当前密码'],
                  ['newPassword', '新密码'],
                  ['confirmPassword', '确认新密码'],
                ].map(([name, label]) => (
                  <label key={name} className="block">
                    <span className="mb-1.5 block text-sm font-medium">{label}</span>
                    <Input type="password" {...register(name as keyof PasswordForm)} />
                    {errors[name as keyof PasswordForm] && (
                      <span className="mt-1 block text-xs text-brick">
                        {errors[name as keyof PasswordForm]?.message}
                      </span>
                    )}
                  </label>
                ))}
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? '提交中…' : '修改密码'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </>
  );
}
