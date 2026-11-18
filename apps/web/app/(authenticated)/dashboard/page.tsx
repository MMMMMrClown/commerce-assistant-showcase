/* oxlint-disable react/only-export-components -- Next.js pages colocate metadata with the component. */
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { PermissionBoundary } from '@/components/permission-boundary';
import { serverApiFetch } from '@/lib/api-server';
import DashboardView, { type Charts, type Overview } from '@/views/dashboard';

export const metadata: Metadata = {
  title: '经营总览',
  description: '查看零售电商最近 30 天及自定义筛选的核心经营指标',
};

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get('sunny_session');
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86400000);
  const query = `?startDate=${start.toISOString().slice(0, 10)}&endDate=${end.toISOString().slice(0, 10)}`;
  const request = {
    headers: { cookie: session ? `${session.name}=${session.value}` : '' },
    cache: 'no-store' as const,
  };
  const [overviewResult, chartsResult] = await Promise.allSettled([
    serverApiFetch<Overview>(`/metrics/overview${query}`, request),
    serverApiFetch<Charts>(`/metrics/charts${query}`, request),
  ]);

  const initialOverview = overviewResult.status === 'fulfilled' ? overviewResult.value : null;
  const initialCharts = chartsResult.status === 'fulfilled' ? chartsResult.value : null;
  return (
    <PermissionBoundary code="dashboard:view">
      <DashboardView initialOverview={initialOverview} initialCharts={initialCharts} />
    </PermissionBoundary>
  );
}
