import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  sandboxRestorePointSchema,
  sandboxRestorePointTrailSchema,
  type GitHubSandboxTargetRegistry,
  type SandboxRestorePoint,
  type SandboxRestorePointTrail,
} from "../schemas";

function buildRestorePointId(createdAt: string, source: string) {
  return `sandbox-restore:${createdAt}:${source}`;
}

function summarizeProfile(registry: GitHubSandboxTargetRegistry, profileId: string) {
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

export function resolveSandboxRestorePointsPath(configPath: string) {
  return `${path.resolve(configPath)}.restore-points.json`;
}

export async function loadSandboxRestorePointTrail(restorePointsPath: string): Promise<SandboxRestorePointTrail> {
  try {
    const raw = await readFile(restorePointsPath, "utf8");
    return sandboxRestorePointTrailSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return sandboxRestorePointTrailSchema.parse({
        updatedAt: new Date(0).toISOString(),
        records: [],
      });
    }
    throw error;
  }
}

export async function saveSandboxRestorePointTrail(restorePointsPath: string, trail: SandboxRestorePointTrail) {
  await mkdir(path.dirname(restorePointsPath), { recursive: true });
  await writeFile(restorePointsPath, `${JSON.stringify(trail, null, 2)}\n`, "utf8");
}

export function formatSandboxRestorePoint(record: SandboxRestorePoint) {
  return `${record.createdAt} ${record.source} profiles=${record.affectedProfileIds.join(",") || "none"} default=${record.previousDefaultProfileId ?? "none"} reason=${record.reason}`;
}

export async function listSandboxRestorePoints(params: {
  configPath: string;
  limit?: number;
}) {
  const restorePointsPath = resolveSandboxRestorePointsPath(params.configPath);
  const trail = await loadSandboxRestorePointTrail(restorePointsPath);
  const limit = Math.max(1, params.limit ?? 10);
  return {
    restorePointsPath,
    trail,
    records: trail.records.slice(-limit).reverse(),
  };
}

export async function createSandboxRestorePoint(params: {
  configPath: string;
  previousRegistry: GitHubSandboxTargetRegistry;
  affectedProfileIds: string[];
  diffSummary: string[];
  source: "apply" | "import" | "batch" | "rollback";
  reason: string;
}) {
  if (params.diffSummary.length === 0) {
    return {
      status: "no_op" as const,
      restorePointsPath: resolveSandboxRestorePointsPath(params.configPath),
      record: null,
      summary: "Sandbox restore point skipped because the change set was a no-op.",
    };
  }

  const createdAt = new Date().toISOString();
  const restorePointsPath = resolveSandboxRestorePointsPath(params.configPath);
  const trail = await loadSandboxRestorePointTrail(restorePointsPath);
  const record = sandboxRestorePointSchema.parse({
    id: buildRestorePointId(createdAt, params.source),
    createdAt,
    source: params.source,
    reason: params.reason,
    affectedProfileIds: params.affectedProfileIds,
    previousDefaultProfileId: params.previousRegistry.defaultProfileId,
    previousProfileSummaries: params.affectedProfileIds
      .map((profileId) => summarizeProfile(params.previousRegistry, profileId))
      .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    previousRegistry: params.previousRegistry,
    diffSummary: params.diffSummary,
  });
  const nextTrail = sandboxRestorePointTrailSchema.parse({
    updatedAt: createdAt,
    records: [...trail.records, record].slice(-30),
  });
  await saveSandboxRestorePointTrail(restorePointsPath, nextTrail);
  return {
    status: "created" as const,
    restorePointsPath,
    record,
    summary: `Sandbox restore point '${record.id}' captured ${record.affectedProfileIds.length} profile(s).`,
  };
}
