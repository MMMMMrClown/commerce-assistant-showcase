import { PermissionBoundary } from '@/components/permission-boundary';
import AgentView from '@/views/agent';

export default function AgentPage() {
  return <PermissionBoundary code="dashboard:view"><AgentView /></PermissionBoundary>;
}
