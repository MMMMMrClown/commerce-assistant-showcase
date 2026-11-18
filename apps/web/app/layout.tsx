/* oxlint-disable react/only-export-components -- Next.js layouts colocate metadata with the component. */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '零售电商智能运营中控台',
    template: '%s | 零售电商智能运营中控台',
  },
  description: '零售电商经营数据与系统管理平台',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
