import { PermissionBoundary } from '@/components/permission-boundary';
import { LogsPage as LogsView } from '@/views/system';

export default function LogsPage() {
  return (
    <PermissionBoundary code="log:view">
      <LogsView />
    </PermissionBoundary>
  );
}
