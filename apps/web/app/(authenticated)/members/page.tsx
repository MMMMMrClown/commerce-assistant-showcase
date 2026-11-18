import { PermissionBoundary } from '@/components/permission-boundary';
import MembersView from '@/views/members';

export default function MembersPage() {
  return (
    <PermissionBoundary code="member:view">
      <MembersView />
    </PermissionBoundary>
  );
}
