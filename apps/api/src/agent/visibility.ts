import type { AuthUser } from '../common/api';
// 【管理员可观测性】使用项目现有超级管理员角色及日志权限，不把ALL数据范围等同管理员。
export const canInspectAgent = (user: AuthUser) =>
  user.roles.some((r) => r.code === 'SUPER_ADMIN') && user.permissions.includes('log:view');
export type ToolTrace = {
  sequence: number;
  toolName: string;
  status: 'SUCCEEDED' | 'FAILED';
  startedAt: string;
  durationMs: number;
  argumentFields: string[];
  errorCode?: string;
  sources?: { section: string; ruleVersion: string; sourcePath: string }[];
};
export function visibleAction(user: AuthUser, value: unknown) {
  if (canInspectAgent(user)) return value;
  const a = value as Record<string, unknown>;
  return Object.fromEntries(
    [
      'id',
      'runId',
      'kind',
      'status',
      'version',
      'payloadHash',
      'expiresAt',
      'payload',
      'result',
    ].map((k) => [k, a[k]]),
  );
}
export function visibleReply<T extends { evidence?: unknown[] }>(user: AuthUser, reply: T): T {
  if (canInspectAgent(user)) return reply;
  return {
    ...reply,
    evidence: reply.evidence?.map((value) => {
      const e = value as { result?: Record<string, unknown>; scope?: string; queriedAt?: string };
      const result =
        e.result && 'sources' in e.result
          ? {
              definition: e.result.definition,
              sources: (e.result.sources as { section?: string; ruleVersion?: string }[]).map(
                (s) => ({ section: s.section, ruleVersion: s.ruleVersion }),
              ),
            }
          : e.result;
      return {
        result:
          result && 'action' in result
            ? { ...result, action: visibleAction(user, result.action) }
            : result,
        scope: e.scope,
        queriedAt: e.queriedAt,
      };
    }),
  };
}
export function visibleConversation<
  T extends {
    messages: unknown;
    state?: unknown;
    leaseToken?: unknown;
    leaseUntil?: unknown;
    actions?: unknown[];
  },
>(user: AuthUser, item: T) {
  const { state, ...rest } = item;
  delete rest.leaseToken;
  delete rest.leaseUntil;
  return {
    ...rest,
    actions: item.actions?.map((a) => visibleAction(user, a)),
    ...(canInspectAgent(user) ? { state } : {}),
    messages: (item.messages as { reply: { evidence?: unknown[] } }[]).map((t) => ({
      ...t,
      reply: visibleReply(user, t.reply),
    })),
  };
}
