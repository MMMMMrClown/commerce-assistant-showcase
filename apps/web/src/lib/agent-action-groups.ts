type TurnRef = {
  reply: { runId?: string; evidence?: { result?: { action?: { id: string; runId?: string } } }[] };
};
type ActionRef = {
  id: string;
  runId?: string;
  status: string;
  kind?: string;
  createdAt?: string;
  payload?: { replacesActionId?: string; proposal?: unknown; batchParentKey?: string };
};
// 操作归属于产生草稿的轮次；修改后的草稿沿用runId，已结束的无归属操作不挂到新回答下。
export function groupActionsByTurn<T extends ActionRef>(turns: TurnRef[], actions: T[]) {
  const byTurn: T[][] = turns.map(() => []),
    unattached: T[] = [];
  for (const action of actions) {
    if (action.payload?.batchParentKey) continue;
    // 修改后的新卡与旧卡共用runId；保留后台历史，只在普通对话中去掉被替代的旧卡。
    const replaced = actions.some((next) => next.payload?.replacesActionId === action.id);
    const newerLegacyProposal =
      action.kind === 'CREATE_SECKILL' &&
      !!action.payload?.proposal &&
      actions.some(
        (next, index) =>
          next.id !== action.id &&
          next.kind === action.kind &&
          !!next.payload?.proposal &&
          !!action.runId &&
          next.runId === action.runId &&
          (action.createdAt && next.createdAt
            ? new Date(next.createdAt).getTime() > new Date(action.createdAt).getTime()
            : index < actions.indexOf(action)),
      );
    if (action.status === 'EXPIRED' && (replaced || newerLegacyProposal)) continue;
    const index = turns.findIndex(
      (turn) =>
        (!!action.runId && turn.reply.runId === action.runId) ||
        turn.reply.evidence?.some(
          (e) =>
            e.result?.action?.id === action.id ||
            (!!action.runId && e.result?.action?.runId === action.runId),
        ),
    );
    if (index >= 0) byTurn[index].push(action);
    else if (['WAITING_CONFIRMATION', 'EXECUTING', 'UNKNOWN'].includes(action.status))
      unattached.push(action);
  }
  return { byTurn, unattached };
}
