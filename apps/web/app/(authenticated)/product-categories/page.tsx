import View from '@/views/product-pages';
import { PermissionBoundary } from '@/components/permission-boundary';
export default function Page() { return <PermissionBoundary code="product-category:view"><View categories /></PermissionBoundary>; }
