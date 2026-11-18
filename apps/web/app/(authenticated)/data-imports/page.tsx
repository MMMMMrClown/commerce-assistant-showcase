import { PermissionBoundary } from '@/components/permission-boundary';
import { ImportPage as ImportView } from '@/views/imports';

export default function DataImportsPage() {
  return (
    <PermissionBoundary code="data-import:create">
      <ImportView />
    </PermissionBoundary>
  );
}
