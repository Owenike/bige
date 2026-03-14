import {
  githubSandboxTargetProfileSchema,
  sandboxPolicyBundleSchema,
  type GitHubSandboxTargetProfile,
  type GitHubSandboxTargetRegistry,
  type SandboxPolicyBundle,
} from "../schemas";
import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";

export type SandboxBundleRecord = SandboxPolicyBundle & {
  bundleId: string;
  source: "builtin" | "registry";
};

export type SandboxBundleApplyResult = {
  status: "resolved" | "manual_required" | "blocked";
  bundleId: string | null;
  source: "builtin" | "registry" | "none";
  profile: GitHubSandboxTargetProfile | null;
  overrideFields: string[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
};

const BUILTIN_BUNDLES: Record<string, SandboxPolicyBundle> = {
  default: sandboxPolicyBundleSchema.parse({
    repository: null,
    targetType: "issue",
    actionPolicy: "create_or_update",
    enabledByDefault: true,
    notes: "Default sandbox bundle.",
  }),
  "create-only": sandboxPolicyBundleSchema.parse({
    repository: null,
    targetType: "issue",
    actionPolicy: "create_only",
    enabledByDefault: true,
    notes: "Create-only sandbox bundle.",
  }),
  "update-only": sandboxPolicyBundleSchema.parse({
    repository: null,
    targetType: "issue",
    actionPolicy: "update_only",
    enabledByDefault: true,
    notes: "Update-only sandbox bundle.",
  }),
  "create-or-update": sandboxPolicyBundleSchema.parse({
    repository: null,
    targetType: "issue",
    actionPolicy: "create_or_update",
    enabledByDefault: true,
    notes: "Create or update sandbox bundle.",
  }),
  "repo-specific": sandboxPolicyBundleSchema.parse({
    repository: null,
    targetType: "issue",
    actionPolicy: "create_or_update",
    enabledByDefault: true,
    notes: "Repository-specific sandbox bundle. Repository must be supplied by override.",
  }),
};

function collectRegistryBundles(registry: GitHubSandboxTargetRegistry) {
  return Object.entries(registry.bundles).map(([bundleId, bundle]) => ({
    bundleId,
    source: "registry" as const,
    ...bundle,
  }));
}

export function listSandboxPolicyBundles(loadedRegistry: LoadedGitHubSandboxTargetRegistry): SandboxBundleRecord[] {
  const builtins = Object.entries(BUILTIN_BUNDLES).map(([bundleId, bundle]) => ({
    bundleId,
    source: "builtin" as const,
    ...bundle,
  }));
  return [...builtins, ...collectRegistryBundles(loadedRegistry.registry)];
}

export function showSandboxPolicyBundle(loadedRegistry: LoadedGitHubSandboxTargetRegistry, bundleId: string | null) {
  if (!bundleId) {
    return null;
  }
  const builtin = BUILTIN_BUNDLES[bundleId];
  if (builtin) {
    return {
      bundleId,
      source: "builtin" as const,
      ...builtin,
    };
  }
  const registryBundle = loadedRegistry.registry.bundles[bundleId];
  if (!registryBundle) {
    return null;
  }
  return {
    bundleId,
    source: "registry" as const,
    ...registryBundle,
  };
}

export function formatSandboxPolicyBundleList(loadedRegistry: LoadedGitHubSandboxTargetRegistry) {
  const bundles = listSandboxPolicyBundles(loadedRegistry);
  const lines = [
    `Sandbox bundles: source=${loadedRegistry.source} version=${loadedRegistry.version} path=${loadedRegistry.path ?? "none"}`,
  ];
  if (bundles.length === 0) {
    lines.push("Bundles: none");
    return lines.join("\n");
  }
  lines.push("Bundles:");
  for (const bundle of bundles) {
    lines.push(
      `- ${bundle.bundleId} [${bundle.source}]: repo=${bundle.repository ?? "override-required"} type=${bundle.targetType ?? "override-required"} action=${bundle.actionPolicy} enabledDefault=${bundle.enabledByDefault}${bundle.notes ? ` notes=${bundle.notes}` : ""}`,
    );
  }
  return lines.join("\n");
}

export function formatSandboxPolicyBundle(bundle: SandboxBundleRecord | null) {
  if (!bundle) {
    return "Sandbox bundle: none";
  }
  return [
    `Sandbox bundle: ${bundle.bundleId}`,
    `Source: ${bundle.source}`,
    `Repository: ${bundle.repository ?? "override-required"}`,
    `Target type: ${bundle.targetType ?? "override-required"}`,
    `Action policy: ${bundle.actionPolicy}`,
    `Enabled by default: ${bundle.enabledByDefault}`,
    `Notes: ${bundle.notes ?? "none"}`,
  ].join("\n");
}

function resolveTemplate(loadedRegistry: LoadedGitHubSandboxTargetRegistry, bundleId: string | null) {
  if (!bundleId) {
    return null;
  }
  const builtin = BUILTIN_BUNDLES[bundleId];
  if (builtin) {
    return {
      bundleId,
      source: "builtin" as const,
      bundle: builtin,
    };
  }
  const registryBundle = loadedRegistry.registry.bundles[bundleId];
  if (registryBundle) {
    return {
      bundleId,
      source: "registry" as const,
      bundle: registryBundle,
    };
  }
  return null;
}

export function applySandboxPolicyBundle(params: {
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  bundleId: string | null;
  existingProfile?: GitHubSandboxTargetProfile | null;
  overrides?: Partial<GitHubSandboxTargetProfile>;
}) {
  if (!params.bundleId) {
    return {
      status: "manual_required",
      bundleId: null,
      source: "none",
      profile: null,
      overrideFields: [],
      summary: "Sandbox bundle id is required.",
      failureReason: "sandbox_bundle_required",
      suggestedNextAction: "Choose a sandbox bundle before applying template defaults.",
    } satisfies SandboxBundleApplyResult;
  }
  const template = resolveTemplate(params.loadedRegistry, params.bundleId);
  if (!template) {
    return {
      status: "manual_required",
      bundleId: params.bundleId,
      source: "none",
      profile: null,
      overrideFields: [],
      summary: `Sandbox bundle '${params.bundleId}' does not exist.`,
      failureReason: "sandbox_bundle_missing",
      suggestedNextAction: "Choose an existing built-in or registry-defined sandbox bundle.",
    } satisfies SandboxBundleApplyResult;
  }

  const overrides = params.overrides ?? {};
  const existing = params.existingProfile ?? null;
  const repository = overrides.repository ?? existing?.repository ?? template.bundle.repository ?? null;
  const targetType = overrides.targetType ?? existing?.targetType ?? template.bundle.targetType ?? null;
  const targetNumber = overrides.targetNumber ?? existing?.targetNumber ?? null;
  const actionPolicy = overrides.actionPolicy ?? existing?.actionPolicy ?? template.bundle.actionPolicy;
  const enabled = overrides.enabled ?? existing?.enabled ?? template.bundle.enabledByDefault;
  const notes = overrides.notes ?? existing?.notes ?? template.bundle.notes ?? null;

  if (!repository || !targetType || !targetNumber) {
    return {
      status: "manual_required",
      bundleId: template.bundleId,
      source: template.source,
      profile: null,
      overrideFields: Object.keys(overrides),
      summary: `Sandbox bundle '${template.bundleId}' needs repository, target type, and target number before it can be applied.`,
      failureReason: "sandbox_bundle_incomplete_target",
      suggestedNextAction: "Provide repository/target type/target number overrides, or apply the bundle to an existing profile with those fields already set.",
    } satisfies SandboxBundleApplyResult;
  }

  const overrideFields = Object.entries({
    repository,
    targetType,
    targetNumber,
    actionPolicy,
    enabled,
    notes,
  })
    .filter(([key, value]) => {
      if (key in overrides) {
        return true;
      }
      const templateValue =
        key === "enabled"
          ? template.bundle.enabledByDefault
          : key === "notes"
            ? template.bundle.notes
            : key === "repository"
              ? template.bundle.repository
              : key === "targetType"
                ? template.bundle.targetType
                : key === "actionPolicy"
                  ? template.bundle.actionPolicy
                  : null;
      return templateValue !== null && value !== templateValue;
    })
    .map(([key]) => key)
    .sort();

  return {
    status: "resolved",
    bundleId: template.bundleId,
    source: template.source,
    profile: githubSandboxTargetProfileSchema.parse({
      repository,
      targetType,
      targetNumber,
      actionPolicy,
      enabled,
      bundleId: template.bundleId,
      overrideFields,
      notes,
    }),
    overrideFields,
    summary: `Sandbox bundle '${template.bundleId}' resolved successfully.`,
    failureReason: null,
    suggestedNextAction: "Review the resolved bundle overrides before applying the sandbox profile change.",
  } satisfies SandboxBundleApplyResult;
}
