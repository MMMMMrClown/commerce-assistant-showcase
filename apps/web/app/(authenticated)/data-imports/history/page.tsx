import { PermissionBoundary } from '@/components/permission-boundary';
import { ImportHistoryPage as ImportHistoryView } from '@/views/imports';

export default function DataImportHistoryPage() {
  return (
    <PermissionBoundary code="data-import:view">
      <ImportHistoryView />
    </PermissionBoundary>
  );
}
