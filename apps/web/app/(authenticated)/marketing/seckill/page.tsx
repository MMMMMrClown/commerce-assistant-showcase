import View from '@/views/seckill';
import { PermissionBoundary } from '@/components/permission-boundary';
export default function Page() { return <PermissionBoundary code="seckill:view"><View  /></PermissionBoundary>; }
