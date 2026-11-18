import { PermissionBoundary } from '@/components/permission-boundary';
import ManagementView from '@/views/management';

export default function RegionsPage() {
  return (
    <PermissionBoundary code="region:view">
      <ManagementView kind="regions" />
    </PermissionBoundary>
  );
}
