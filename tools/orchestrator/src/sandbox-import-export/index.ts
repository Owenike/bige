import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  githubSandboxTargetProfileSchema,
  githubSandboxTargetRegistrySchema,
  type GitHubSandboxTargetRegistry,
  type OrchestratorState,
} from "../schemas";
import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import {
  applySandboxRegistryChange,
  buildSandboxRegistryDiff,
  reviewSandboxRegistryChange,
} from "../sandbox-change-review";
import { cloneSandboxRegistry } from "../sandbox-profile-lifecycle";

const sandboxImportProfilePayloadSchema = z.object({
  kind: z.literal("profile"),
  profileId: z.string().min(1),
  profile: githubSandboxTargetProfileSchema,
  setDefault: z.boolean().default(false),
});

const sandboxImportRegistryPayloadSchema = z.object({
  kind: z.literal("registry"),
  registry: githubSandboxTargetRegistrySchema,
});

const sandboxImportSnapshotPayloadSchema = z.object({
  kind: z.literal("snapshot"),
  createdAt: z.string(),
  registry: githubSandboxTargetRegistrySchema,
});

const sandboxImportPayloadSchema = z.union([
  sandboxImportProfilePayloadSchema,
  sandboxImportRegistryPayloadSchema,
  sandboxImportSnapshotPayloadSchema,
]);

export type SandboxImportExportResult = {
  status: "exported" | "snapshot_created" | "previewed" | "imported" | "blocked" | "manual_required" | "failed";
  mode: "export_profile" | "export_all" | "snapshot" | "preview" | "apply";
  affectedProfileIds: string[];
  diffSummary: string[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  outputPath: string | null;
  registry: GitHubSandboxTargetRegistry | null;
  auditId: string | null;
};

function buildImportTargetRegistry(
  loadedRegistry: LoadedGitHubSandboxTargetRegistry,
  payload: z.infer<typeof sandboxImportPayloadSchema>,
) {
  if (payload.kind === "registry" || payload.kind === "snapshot") {
    return cloneSandboxRegistry(payload.registry);
  }
  const next = cloneSandboxRegistry(loadedRegistry.registry);
  next.profiles[payload.profileId] = payload.profile;
  if (payload.setDefault) {
    next.defaultProfileId = payload.profileId;
  }
  return next;
}

async function writeJson(outputPath: string, data: unknown) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function exportSandboxProfiles(params: {
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  outputPath: string;
  profileId?: string | null;
  snapshot?: boolean;
}) {
  const profileId = params.profileId ?? null;
  if (profileId) {
    const profile = params.loadedRegistry.registry.profiles[profileId];
    if (!profile) {
      return {
        status: "manual_required",
        mode: "export_profile",
        affectedProfileIds: [],
        diffSummary: [],
        summary: `Sandbox profile '${profileId}' does not exist.`,
        failureReason: "sandbox_profile_missing",
        suggestedNextAction: "Choose an existing sandbox profile before export.",
        outputPath: null,
        registry: null,
        auditId: null,
      } satisfies SandboxImportExportResult;
    }
    await writeJson(params.outputPath, {
      kind: "profile",
      profileId,
      profile,
      setDefault: params.loadedRegistry.registry.defaultProfileId === profileId,
    });
    return {
      status: "exported",
      mode: "export_profile",
      affectedProfileIds: [profileId],
      diffSummary: [],
      summary: `Exported sandbox profile '${profileId}'.`,
      failureReason: null,
      suggestedNextAction: "Review or import the exported profile payload as needed.",
      outputPath: params.outputPath,
      registry: null,
      auditId: null,
    } satisfies SandboxImportExportResult;
  }

  const payload = params.snapshot
    ? {
        kind: "snapshot" as const,
        createdAt: new Date().toISOString(),
        registry: params.loadedRegistry.registry,
      }
    : {
        kind: "registry" as const,
        registry: params.loadedRegistry.registry,
      };
  await writeJson(params.outputPath, payload);
  return {
    status: params.snapshot ? "snapshot_created" : "exported",
    mode: params.snapshot ? "snapshot" : "export_all",
    affectedProfileIds: Object.keys(params.loadedRegistry.registry.profiles).sort(),
    diffSummary: [],
    summary: params.snapshot ? "Created sandbox registry snapshot." : "Exported all sandbox profiles.",
    failureReason: null,
    suggestedNextAction: "Use the exported payload for backup, preview, or import review.",
    outputPath: params.outputPath,
    registry: params.loadedRegistry.registry,
    auditId: null,
  } satisfies SandboxImportExportResult;
}

export async function importSandboxProfiles(params: {
  configPath: string;
  inputPath: string;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  state: OrchestratorState;
  mode: "preview" | "apply";
  actorSource: string;
  commandSource?: string | null;
}) {
  const raw = await readFile(path.resolve(params.inputPath), "utf8");
  const payload = sandboxImportPayloadSchema.parse(JSON.parse(raw));
  const proposedRegistry = buildImportTargetRegistry(params.loadedRegistry, payload);
  const diffs = buildSandboxRegistryDiff(params.loadedRegistry.registry, proposedRegistry).map((item) => item.summary);

  if (params.mode === "preview") {
    const review = await reviewSandboxRegistryChange({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      proposedRegistry,
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? "cli",
      recordAudit: false,
    });
    return {
      status: review.status === "ready" ? "previewed" : review.status,
      mode: "preview",
      affectedProfileIds: review.affectedProfileIds,
      diffSummary: review.diffSummary,
      summary: review.summary,
      failureReason: review.failureReason,
      suggestedNextAction: review.suggestedNextAction,
      outputPath: null,
      registry: proposedRegistry,
      auditId: review.auditId,
    } satisfies SandboxImportExportResult;
  }

  const applied = await applySandboxRegistryChange({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    proposedRegistry,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? "cli",
  });
  return {
    status: applied.status === "ready" ? "imported" : applied.status,
    mode: "apply",
    affectedProfileIds: applied.affectedProfileIds,
    diffSummary: applied.diffSummary.length > 0 ? applied.diffSummary : diffs,
    summary: applied.summary,
    failureReason: applied.failureReason,
    suggestedNextAction: applied.suggestedNextAction,
    outputPath: null,
    registry: applied.appliedRegistry ?? null,
    auditId: applied.applyAuditId ?? applied.auditId,
  } satisfies SandboxImportExportResult;
}
