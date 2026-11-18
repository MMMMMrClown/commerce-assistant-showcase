import View from '@/views/member-policy';
import { PermissionBoundary } from '@/components/permission-boundary';
export default function Page() { return <PermissionBoundary code="member:view"><View benefits /></PermissionBoundary>; }
