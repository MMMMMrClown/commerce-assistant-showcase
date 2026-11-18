import View from '@/views/coupon-records';
import {PermissionBoundary} from '@/components/permission-boundary';
export default function Page(){return <PermissionBoundary code="member:view"><View/></PermissionBoundary>}