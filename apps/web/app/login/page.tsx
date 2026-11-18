/* oxlint-disable react/only-export-components -- Next.js pages colocate metadata with the component. */
import type { Metadata } from 'next';
import { Provider } from '@/components/provider';
import LoginView from '@/views/login';

export const metadata: Metadata = {
  title: '登录',
  description: '登录零售电商智能运营中控台',
};

// 【演示配置】云端专用演示密码在运行时读取，不把真实业务密钥写入前端构建。
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Provider>
      <LoginView
        demoPassword={
          process.env.DEMO_MODE === 'true' ? process.env.DEMO_LOGIN_PASSWORD : undefined
        }
      />
    </Provider>
  );
}
