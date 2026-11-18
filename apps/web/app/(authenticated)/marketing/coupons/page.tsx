import View from '@/views/marketing';
import { PermissionBoundary } from '@/components/permission-boundary';
export default function Page() { return <PermissionBoundary code="member:coupon-issue"><PermissionBoundary code="member:view"><View coupons /></PermissionBoundary></PermissionBoundary>; }
