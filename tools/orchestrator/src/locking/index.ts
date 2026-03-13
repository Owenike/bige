import type { QueueRunItem } from "../schemas";

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function buildLockScopeKeys(params: {
  stateId: string;
  repoPath: string;
  workspaceRoot?: string | null;
}) {
  return unique([`state:${params.stateId}`, `repo:${params.repoPath}`, params.workspaceRoot ? `workspace:${params.workspaceRoot}` : ""]);
}

export function hasLeaseExpired(item: QueueRunItem, now: Date) {
  if (!item.leaseExpiresAt) {
    return item.status === "running";
  }
  return new Date(item.leaseExpiresAt).getTime() <= now.getTime();
}

export function createLeaseTimestamps(now: Date, leaseMs: number) {
  return {
    lastHeartbeatAt: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
  };
}

export function hasLockConflict(params: {
  candidate: QueueRunItem;
  items: QueueRunItem[];
  now: Date;
}) {
  const candidateScopes = new Set(params.candidate.lockScopeKeys);
  return params.items.some((item) => {
    if (item.id === params.candidate.id) return false;
    if (item.status !== "running") return false;
    if (hasLeaseExpired(item, params.now)) return false;
    return item.lockScopeKeys.some((scope) => candidateScopes.has(scope));
  });
}
