import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  githubSandboxTargetProfileSchema,
  githubSandboxTargetRegistrySchema,
  type GitHubSandboxActionPolicy,
  type GitHubSandboxTargetRegistry,
} from "../schemas";
import { loadGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import { appendSandboxAuditRecord } from "../sandbox-audit";
import { evaluateSandboxProfileGovernance } from "../sandbox-governance";

export type SandboxProfileLifecycleResult = {
  status: "updated" | "manual_required" | "blocked";
  action: "create" | "update" | "delete" | "set_default";
  profileId: string | null;
  defaultProfileId: string | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  path: string | null;
  registry: GitHubSandboxTargetRegistry | null;
  auditId: string | null;
  governanceStatus: "unknown" | "ready" | "blocked" | "manual_required";
  governanceReason: string | null;
};

type SandboxProfileInput = {
  repository: string;
  targetType: "issue" | "pull_request";
  targetNumber: number;
  actionPolicy: GitHubSandboxActionPolicy;
  enabled?: boolean;
  notes?: string | null;
};

const EMPTY_REGISTRY = githubSandboxTargetRegistrySchema.parse({
  version: "sandbox-managed-v1",
  defaultProfileId: null,
  profiles: {},
});

function cloneRegistry(registry: GitHubSandboxTargetRegistry) {
  return githubSandboxTargetRegistrySchema.parse(JSON.parse(JSON.stringify(registry)));
}

function normalizeRegistry(registry: GitHubSandboxTargetRegistry) {
  const next = cloneRegistry(registry);
  const enabledProfiles = Object.entries(next.profiles)
    .filter(([, profile]) => profile.enabled !== false)
    .map(([profileId]) => profileId)
    .sort();

  if (next.defaultProfileId && next.profiles[next.defaultProfileId]?.enabled !== false) {
    return next;
  }

  next.defaultProfileId = enabledProfiles[0] ?? null;
  return next;
}

async function ensureWritableRegistry(configPath?: string | null) {
  const requestedPath = configPath ?? process.env.ORCHESTRATOR_GITHUB_SANDBOX_TARGETS_CONFIG ?? null;
  if (!requestedPath) {
    return {
      status: "manual_required" as const,
      summary: "Sandbox profile lifecycle commands require a writable JSON config path.",
      failureReason: "sandbox_profile_config_path_missing",
      suggestedNextAction: "Pass --sandbox-config path/to/sandbox-targets.json or set ORCHESTRATOR_GITHUB_SANDBOX_TARGETS_CONFIG.",
      path: null,
      loaded: null,
    };
  }

  const resolvedPath = path.resolve(requestedPath);
  try {
    const loaded = await loadGitHubSandboxTargetRegistry({ configPath: resolvedPath });
    if (loaded.source !== "file") {
      return {
        status: "blocked" as const,
        summary: "Sandbox profile lifecycle commands can only modify file-backed registry configs.",
        failureReason: "sandbox_profile_registry_not_file_backed",
        suggestedNextAction: "Use a JSON config file for sandbox target management.",
        path: resolvedPath,
        loaded: null,
      };
    }
    return {
      status: "updated" as const,
      summary: "Loaded writable sandbox registry config.",
      failureReason: null,
      suggestedNextAction: "Proceed with the requested sandbox profile lifecycle change.",
      path: resolvedPath,
      loaded,
    };
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/i.test(error.message)) {
      throw error;
    }

    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, `${JSON.stringify(EMPTY_REGISTRY, null, 2)}\n`, "utf8");
    const loaded = await loadGitHubSandboxTargetRegistry({ configPath: resolvedPath });
    return {
      status: "updated" as const,
      summary: "Created a new writable sandbox registry config.",
      failureReason: null,
      suggestedNextAction: "Proceed with the requested sandbox profile lifecycle change.",
      path: resolvedPath,
      loaded,
    };
  }
}

async function saveRegistry(resolvedPath: string, registry: GitHubSandboxTargetRegistry) {
  const normalized = normalizeRegistry(registry);
  await writeFile(resolvedPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function toLifecycleResult(
  params: Omit<SandboxProfileLifecycleResult, "registry" | "auditId" | "governanceStatus" | "governanceReason"> & {
    registry?: GitHubSandboxTargetRegistry | null;
    auditId?: string | null;
    governanceStatus?: SandboxProfileLifecycleResult["governanceStatus"];
    governanceReason?: string | null;
  },
) {
  return {
    ...params,
    registry: params.registry ?? null,
    auditId: params.auditId ?? null,
    governanceStatus: params.governanceStatus ?? "unknown",
    governanceReason: params.governanceReason ?? null,
  } satisfies SandboxProfileLifecycleResult;
}

export async function createSandboxProfile(params: {
  configPath?: string | null;
  profileId: string;
  profile: SandboxProfileInput;
  setDefault?: boolean;
}) {
  const writable = await ensureWritableRegistry(params.configPath);
  if (writable.status !== "updated" || !writable.path || !writable.loaded) {
    return toLifecycleResult({
      status: writable.status,
      action: "create",
      profileId: params.profileId,
      defaultProfileId: null,
      summary: writable.summary,
      failureReason: writable.failureReason,
      suggestedNextAction: writable.suggestedNextAction,
      path: writable.path,
    });
  }

  const registry = cloneRegistry(writable.loaded.registry);
  const previousRegistry = cloneRegistry(registry);
  if (registry.profiles[params.profileId]) {
    return toLifecycleResult({
      status: "blocked",
      action: "create",
      profileId: params.profileId,
      defaultProfileId: registry.defaultProfileId,
      summary: `Sandbox profile '${params.profileId}' already exists.`,
      failureReason: "sandbox_profile_already_exists",
      suggestedNextAction: "Use sandbox:update if you intend to modify the existing profile.",
      path: writable.path,
      registry,
    });
  }

  registry.profiles[params.profileId] = githubSandboxTargetProfileSchema.parse(params.profile);
  if (params.setDefault) {
    registry.defaultProfileId = params.profileId;
  }
  const saved = await saveRegistry(writable.path, registry);
  const governance = evaluateSandboxProfileGovernance({
    loadedRegistry: {
      registry: saved,
      version: saved.version,
      source: "file",
      path: writable.path,
    },
    profileId: params.profileId,
    requireDefaultSafePolicy: saved.defaultProfileId === params.profileId,
  });
  const audit = await appendSandboxAuditRecord({
    configPath: writable.path,
    action: "create",
    profileId: params.profileId,
    previousRegistry,
    nextRegistry: saved,
    actorSource: "sandbox:create",
    commandSource: "cli",
  });
  return toLifecycleResult({
    status: "updated",
    action: "create",
    profileId: params.profileId,
    defaultProfileId: saved.defaultProfileId,
    summary: `Sandbox profile '${params.profileId}' was created.`,
    failureReason: null,
    suggestedNextAction: "Validate the new sandbox profile before using it for live auth smoke.",
    path: writable.path,
    registry: saved,
    auditId: audit.record.id,
    governanceStatus: governance.status,
    governanceReason: null,
  });
}

export async function updateSandboxProfile(params: {
  configPath?: string | null;
  profileId: string;
  changes: Partial<SandboxProfileInput>;
}) {
  const writable = await ensureWritableRegistry(params.configPath);
  if (writable.status !== "updated" || !writable.path || !writable.loaded) {
    return toLifecycleResult({
      status: writable.status,
      action: "update",
      profileId: params.profileId,
      defaultProfileId: null,
      summary: writable.summary,
      failureReason: writable.failureReason,
      suggestedNextAction: writable.suggestedNextAction,
      path: writable.path,
    });
  }

  const registry = cloneRegistry(writable.loaded.registry);
  const previousRegistry = cloneRegistry(registry);
  const existing = registry.profiles[params.profileId];
  if (!existing) {
    return toLifecycleResult({
      status: "manual_required",
      action: "update",
      profileId: params.profileId,
      defaultProfileId: registry.defaultProfileId,
      summary: `Sandbox profile '${params.profileId}' does not exist.`,
      failureReason: "sandbox_profile_missing",
      suggestedNextAction: "Create the sandbox profile first, or choose an existing profile id.",
      path: writable.path,
      registry,
    });
  }

  registry.profiles[params.profileId] = githubSandboxTargetProfileSchema.parse({
    ...existing,
    ...params.changes,
  });
  const saved = await saveRegistry(writable.path, registry);
  const governance = evaluateSandboxProfileGovernance({
    loadedRegistry: {
      registry: saved,
      version: saved.version,
      source: "file",
      path: writable.path,
    },
    profileId: params.profileId,
    requireDefaultSafePolicy: saved.defaultProfileId === params.profileId,
  });
  const enabledAction =
    typeof params.changes.enabled === "boolean" && params.changes.enabled !== (existing.enabled !== false)
      ? params.changes.enabled
        ? "enable"
        : "disable"
      : "update";
  const audit = await appendSandboxAuditRecord({
    configPath: writable.path,
    action: enabledAction,
    profileId: params.profileId,
    previousRegistry,
    nextRegistry: saved,
    actorSource: `sandbox:${enabledAction}`,
    commandSource: "cli",
  });
  return toLifecycleResult({
    status: "updated",
    action: "update",
    profileId: params.profileId,
    defaultProfileId: saved.defaultProfileId,
    summary: `Sandbox profile '${params.profileId}' was updated.`,
    failureReason: null,
    suggestedNextAction: "Re-run sandbox validation before using the updated profile for live auth smoke.",
    path: writable.path,
    registry: saved,
    auditId: audit.record.id,
    governanceStatus: governance.status,
    governanceReason: null,
  });
}

export async function deleteSandboxProfile(params: {
  configPath?: string | null;
  profileId: string;
}) {
  const writable = await ensureWritableRegistry(params.configPath);
  if (writable.status !== "updated" || !writable.path || !writable.loaded) {
    return toLifecycleResult({
      status: writable.status,
      action: "delete",
      profileId: params.profileId,
      defaultProfileId: null,
      summary: writable.summary,
      failureReason: writable.failureReason,
      suggestedNextAction: writable.suggestedNextAction,
      path: writable.path,
    });
  }

  const registry = cloneRegistry(writable.loaded.registry);
  const previousRegistry = cloneRegistry(registry);
  if (!registry.profiles[params.profileId]) {
    return toLifecycleResult({
      status: "manual_required",
      action: "delete",
      profileId: params.profileId,
      defaultProfileId: registry.defaultProfileId,
      summary: `Sandbox profile '${params.profileId}' does not exist.`,
      failureReason: "sandbox_profile_missing",
      suggestedNextAction: "Choose an existing sandbox profile id before deleting.",
      path: writable.path,
      registry,
    });
  }

  delete registry.profiles[params.profileId];
  if (registry.defaultProfileId === params.profileId) {
    registry.defaultProfileId = null;
  }
  const saved = await saveRegistry(writable.path, registry);
  const audit = await appendSandboxAuditRecord({
    configPath: writable.path,
    action: "delete",
    profileId: params.profileId,
    previousRegistry,
    nextRegistry: saved,
    actorSource: "sandbox:delete",
    commandSource: "cli",
  });
  return toLifecycleResult({
    status: "updated",
    action: "delete",
    profileId: params.profileId,
    defaultProfileId: saved.defaultProfileId,
    summary: `Sandbox profile '${params.profileId}' was deleted.`,
    failureReason: null,
    suggestedNextAction:
      saved.defaultProfileId ? `Default sandbox profile is now '${saved.defaultProfileId}'. Validate it before the next live smoke.` : "Set a new default sandbox profile before running live auth smoke without an explicit profile.",
    path: writable.path,
    registry: saved,
    auditId: audit.record.id,
  });
}

export async function setDefaultSandboxProfile(params: {
  configPath?: string | null;
  profileId: string;
}) {
  const writable = await ensureWritableRegistry(params.configPath);
  if (writable.status !== "updated" || !writable.path || !writable.loaded) {
    return toLifecycleResult({
      status: writable.status,
      action: "set_default",
      profileId: params.profileId,
      defaultProfileId: null,
      summary: writable.summary,
      failureReason: writable.failureReason,
      suggestedNextAction: writable.suggestedNextAction,
      path: writable.path,
    });
  }

  const registry = cloneRegistry(writable.loaded.registry);
  const previousRegistry = cloneRegistry(registry);
  const profile = registry.profiles[params.profileId];
  if (!profile) {
    return toLifecycleResult({
      status: "manual_required",
      action: "set_default",
      profileId: params.profileId,
      defaultProfileId: registry.defaultProfileId,
      summary: `Sandbox profile '${params.profileId}' does not exist.`,
      failureReason: "sandbox_profile_missing",
      suggestedNextAction: "Create the sandbox profile first, or choose an existing profile id.",
      path: writable.path,
      registry,
    });
  }
  if (profile.enabled === false) {
    return toLifecycleResult({
      status: "blocked",
      action: "set_default",
      profileId: params.profileId,
      defaultProfileId: registry.defaultProfileId,
      summary: `Sandbox profile '${params.profileId}' is disabled and cannot become the default.`,
      failureReason: "sandbox_profile_disabled",
      suggestedNextAction: "Enable the sandbox profile before setting it as default.",
      path: writable.path,
      registry,
    });
  }
  const governance = evaluateSandboxProfileGovernance({
    loadedRegistry: {
      registry,
      version: registry.version,
      source: "file",
      path: writable.path,
    },
    profileId: params.profileId,
    requireDefaultSafePolicy: true,
  });
  if (governance.status !== "ready") {
    return toLifecycleResult({
      status: governance.status === "blocked" ? "blocked" : "manual_required",
      action: "set_default",
      profileId: params.profileId,
      defaultProfileId: registry.defaultProfileId,
      summary: governance.summary,
      failureReason: governance.reason?.code ?? "sandbox_profile_governance_failed",
      suggestedNextAction: governance.reason?.suggestedNextAction ?? "Fix sandbox governance issues before switching the default profile.",
      path: writable.path,
      registry,
      governanceStatus: governance.status,
      governanceReason: governance.reason?.summary ?? null,
    });
  }

  registry.defaultProfileId = params.profileId;
  const saved = await saveRegistry(writable.path, registry);
  const audit = await appendSandboxAuditRecord({
    configPath: writable.path,
    action: "set-default",
    profileId: params.profileId,
    previousRegistry,
    nextRegistry: saved,
    actorSource: "sandbox:set-default",
    commandSource: "cli",
  });
  return toLifecycleResult({
    status: "updated",
    action: "set_default",
    profileId: params.profileId,
    defaultProfileId: saved.defaultProfileId,
    summary: `Sandbox profile '${params.profileId}' is now the default profile.`,
    failureReason: null,
    suggestedNextAction: "Use the default sandbox profile for the next live auth smoke or validate it first.",
    path: writable.path,
    registry: saved,
    auditId: audit.record.id,
    governanceStatus: governance.status,
    governanceReason: null,
  });
}
