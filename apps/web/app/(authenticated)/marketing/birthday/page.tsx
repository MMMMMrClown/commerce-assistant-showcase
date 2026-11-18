import View from '@/views/member-marketing';
import { PermissionBoundary } from '@/components/permission-boundary';
export default function Page(){return <PermissionBoundary code="member:view"><View kind="BIRTHDAY"/></PermissionBoundary>}