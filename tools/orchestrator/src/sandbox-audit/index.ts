import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  sandboxAuditTrailSchema,
  sandboxAuditRecordSchema,
  type GitHubSandboxTargetRegistry,
  type SandboxAuditAction,
  type SandboxAuditRecord,
  type SandboxAuditTrail,
} from "../schemas";

function buildAuditId(changedAt: string, action: SandboxAuditAction, profileId: string | null) {
  return `sandbox-audit:${changedAt}:${action}:${profileId ?? "none"}`;
}

export function resolveSandboxAuditPath(configPath: string) {
  return `${path.resolve(configPath)}.audit.json`;
}

function summarizeProfile(registry: GitHubSandboxTargetRegistry, profileId: string | null) {
  if (!profileId) {
    return null;
  }
  const profile = registry.profiles[profileId];
  if (!profile) {
    return null;
  }
  return {
    profileId,
    repository: profile.repository,
    targetType: profile.targetType,
    targetNumber: profile.targetNumber,
    actionPolicy: profile.actionPolicy,
    enabled: profile.enabled !== false,
    isDefault: registry.defaultProfileId === profileId,
    bundleId: profile.bundleId ?? null,
    overrideFields: profile.overrideFields ?? [],
    notes: profile.notes ?? null,
  };
}

function detectChangedFields(previousRegistry: GitHubSandboxTargetRegistry, nextRegistry: GitHubSandboxTargetRegistry, profileId: string | null) {
  const previous = summarizeProfile(previousRegistry, profileId);
  const next = summarizeProfile(nextRegistry, profileId);
  const changed = new Set<string>();
  if ((previousRegistry.defaultProfileId ?? null) !== (nextRegistry.defaultProfileId ?? null)) {
    changed.add("defaultProfileId");
  }
  for (const field of ["repository", "targetType", "targetNumber", "actionPolicy", "enabled", "notes", "isDefault", "bundleId"] as const) {
    if ((previous?.[field] ?? null) !== (next?.[field] ?? null)) {
      changed.add(field);
    }
  }
  if (JSON.stringify(previous?.overrideFields ?? []) !== JSON.stringify(next?.overrideFields ?? [])) {
    changed.add("overrideFields");
  }
  if (!previous && next) {
    changed.add("profile_created");
  }
  if (previous && !next) {
    changed.add("profile_deleted");
  }
  return Array.from(changed);
}

async function loadAuditTrail(auditPath: string): Promise<SandboxAuditTrail> {
  try {
    const raw = await readFile(auditPath, "utf8");
    return sandboxAuditTrailSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return sandboxAuditTrailSchema.parse({
        updatedAt: new Date(0).toISOString(),
        records: [],
      });
    }
    throw error;
  }
}

async function saveAuditTrail(auditPath: string, auditTrail: SandboxAuditTrail) {
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify(auditTrail, null, 2)}\n`, "utf8");
}

export function formatSandboxAuditRecord(record: SandboxAuditRecord) {
  return [
    `${record.changedAt}`,
    record.action,
    `profile=${record.profileId ?? "none"}`,
    `fields=${record.changedFields.join(",") || "none"}`,
    `source=${record.actorSource}`,
    `restore=${record.restorePointId ?? "none"}`,
    `rollback=${record.rollbackMode ?? "none"}`,
    `decision=${record.decision ?? "none"}`,
    `failure=${record.failureReason ?? "none"}`,
  ].join(" ");
}

export function formatSandboxAuditTrail(records: SandboxAuditRecord[]) {
  if (records.length === 0) {
    return "Sandbox audit trail: none";
  }
  return ["Sandbox audit trail:", ...records.map((record) => `- ${formatSandboxAuditRecord(record)}`)].join("\n");
}

export async function listSandboxAuditRecords(params: {
  configPath: string;
  limit?: number;
}) {
  const auditPath = resolveSandboxAuditPath(params.configPath);
  const trail = await loadAuditTrail(auditPath);
  const limit = Math.max(1, params.limit ?? 10);
  return {
    auditPath,
    trail,
    records: trail.records.slice(-limit).reverse(),
  };
}

export async function appendSandboxAuditRecord(params: {
  configPath: string;
  action: SandboxAuditAction;
  profileId: string | null;
  previousRegistry: GitHubSandboxTargetRegistry;
  nextRegistry: GitHubSandboxTargetRegistry;
  actorSource: string;
  commandSource?: string | null;
  restorePointId?: string | null;
  rollbackMode?: "preview" | "validate" | "apply" | null;
  decision?: string | null;
  diffSummary?: string[];
  failureReason?: string | null;
}) {
  const changedAt = new Date().toISOString();
  const auditPath = resolveSandboxAuditPath(params.configPath);
  const trail = await loadAuditTrail(auditPath);
  const record = sandboxAuditRecordSchema.parse({
    id: buildAuditId(changedAt, params.action, params.profileId),
    changedAt,
    action: params.action,
    profileId: params.profileId,
    previousSummary: summarizeProfile(params.previousRegistry, params.profileId),
    nextSummary: summarizeProfile(params.nextRegistry, params.profileId),
    changedFields: detectChangedFields(params.previousRegistry, params.nextRegistry, params.profileId),
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    restorePointId: params.restorePointId ?? null,
    rollbackMode: params.rollbackMode ?? null,
    decision: params.decision ?? null,
    diffSummary: params.diffSummary ?? [],
    failureReason: params.failureReason ?? null,
  });
  const nextTrail = sandboxAuditTrailSchema.parse({
    updatedAt: changedAt,
    records: [...trail.records, record].slice(-50),
  });
  await saveAuditTrail(auditPath, nextTrail);
  return {
    auditPath,
    record,
    recentSummaries: nextTrail.records.slice(-5).map((item) => formatSandboxAuditRecord(item)),
  };
}
