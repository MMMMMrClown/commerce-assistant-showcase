import { PermissionBoundary } from '@/components/permission-boundary';
import { RolesPage as RolesView } from '@/views/system';

export default function RolesPage() {
  return (
    <PermissionBoundary code="role:view">
      <RolesView />
    </PermissionBoundary>
  );
}
