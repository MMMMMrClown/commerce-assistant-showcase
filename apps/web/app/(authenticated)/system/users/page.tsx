import { PermissionBoundary } from '@/components/permission-boundary';
import { UsersPage as UsersView } from '@/views/system';

export default function UsersPage() {
  return (
    <PermissionBoundary code="user:view">
      <UsersView />
    </PermissionBoundary>
  );
}
