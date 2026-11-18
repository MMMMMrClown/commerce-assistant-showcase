import View from '@/views/payment-records';
import { PermissionBoundary } from '@/components/permission-boundary';
export default function Page() { return <PermissionBoundary code="order:view"><View refunds /></PermissionBoundary>; }