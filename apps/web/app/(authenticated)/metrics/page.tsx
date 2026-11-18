import { PermissionBoundary } from '@/components/permission-boundary';
import { MetricsPage as MetricsView } from '@/views/system';

export default function MetricsPage() {
  return (
    <PermissionBoundary code="metric:view">
      <MetricsView />
    </PermissionBoundary>
  );
}
