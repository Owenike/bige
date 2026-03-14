import { readFile } from "node:fs/promises";
import path from "node:path";

export type ActorPolicyConfig = {
  adminActors: string[];
  runActors: string[];
  approverActors: string[];
  statusActors: string[];
  liveActors: string[];
};

export type LoadedActorPolicyConfig = {
  config: ActorPolicyConfig;
  version: string;
  source: "default" | "env" | "file";
  path: string | null;
};

export const DEFAULT_ACTOR_POLICY_CONFIG: ActorPolicyConfig = {
  adminActors: ["orchestrator-admin"],
  runActors: ["orchestrator-admin", "orchestrator-runner"],
  approverActors: ["orchestrator-admin", "orchestrator-approver"],
  statusActors: ["orchestrator-admin", "orchestrator-runner", "orchestrator-approver", "orchestrator-viewer"],
  liveActors: ["orchestrator-admin", "orchestrator-approver"],
};

function parseActorList(value: string | undefined, fallback: string[]) {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [...fallback];
}

function normalizeConfig(input: Partial<ActorPolicyConfig> | null | undefined): ActorPolicyConfig {
  return {
    adminActors: [...(input?.adminActors ?? DEFAULT_ACTOR_POLICY_CONFIG.adminActors)],
    runActors: [...(input?.runActors ?? DEFAULT_ACTOR_POLICY_CONFIG.runActors)],
    approverActors: [...(input?.approverActors ?? DEFAULT_ACTOR_POLICY_CONFIG.approverActors)],
    statusActors: [...(input?.statusActors ?? DEFAULT_ACTOR_POLICY_CONFIG.statusActors)],
    liveActors: [...(input?.liveActors ?? DEFAULT_ACTOR_POLICY_CONFIG.liveActors)],
  };
}

export function loadActorPolicyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LoadedActorPolicyConfig {
  const hasExplicitEnv =
    Boolean(env.ORCHESTRATOR_ACTOR_ADMINS) ||
    Boolean(env.ORCHESTRATOR_ACTOR_RUNNERS) ||
    Boolean(env.ORCHESTRATOR_ACTOR_APPROVERS) ||
    Boolean(env.ORCHESTRATOR_ACTOR_STATUS) ||
    Boolean(env.ORCHESTRATOR_ACTOR_LIVE);

  return {
    config: {
      adminActors: parseActorList(env.ORCHESTRATOR_ACTOR_ADMINS, DEFAULT_ACTOR_POLICY_CONFIG.adminActors),
      runActors: parseActorList(env.ORCHESTRATOR_ACTOR_RUNNERS, DEFAULT_ACTOR_POLICY_CONFIG.runActors),
      approverActors: parseActorList(env.ORCHESTRATOR_ACTOR_APPROVERS, DEFAULT_ACTOR_POLICY_CONFIG.approverActors),
      statusActors: parseActorList(env.ORCHESTRATOR_ACTOR_STATUS, DEFAULT_ACTOR_POLICY_CONFIG.statusActors),
      liveActors: parseActorList(env.ORCHESTRATOR_ACTOR_LIVE, DEFAULT_ACTOR_POLICY_CONFIG.liveActors),
    },
    version: hasExplicitEnv ? "env-overrides-v1" : "env-defaults-v1",
    source: hasExplicitEnv ? "env" : "default",
    path: null,
  };
}

function parseConfigFile(raw: string): { version?: string; config?: Partial<ActorPolicyConfig> } {
  const parsed = JSON.parse(raw) as {
    version?: unknown;
    adminActors?: unknown;
    runActors?: unknown;
    approverActors?: unknown;
    statusActors?: unknown;
    liveActors?: unknown;
    config?: Partial<ActorPolicyConfig>;
  };
  return {
    version: typeof parsed.version === "string" ? parsed.version : undefined,
    config: parsed.config ?? {
      adminActors: Array.isArray(parsed.adminActors) ? parsed.adminActors.filter((value): value is string => typeof value === "string") : undefined,
      runActors: Array.isArray(parsed.runActors) ? parsed.runActors.filter((value): value is string => typeof value === "string") : undefined,
      approverActors: Array.isArray(parsed.approverActors) ? parsed.approverActors.filter((value): value is string => typeof value === "string") : undefined,
      statusActors: Array.isArray(parsed.statusActors) ? parsed.statusActors.filter((value): value is string => typeof value === "string") : undefined,
      liveActors: Array.isArray(parsed.liveActors) ? parsed.liveActors.filter((value): value is string => typeof value === "string") : undefined,
    },
  };
}

export async function loadActorPolicyConfig(params?: {
  configPath?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params?.env ?? process.env;
  const requestedPath = params?.configPath ?? env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null;
  if (!requestedPath) {
    return loadActorPolicyConfigFromEnv(env);
  }

  const resolvedPath = path.resolve(requestedPath);
  const raw = await readFile(resolvedPath, "utf8");
  const parsed = parseConfigFile(raw);
  return {
    config: normalizeConfig(parsed.config),
    version: parsed.version ?? `file:${path.basename(resolvedPath)}`,
    source: "file" as const,
    path: resolvedPath,
  };
}

export function describeActorPolicyConfig(loaded: LoadedActorPolicyConfig) {
  return [
    `source=${loaded.source}`,
    `version=${loaded.version}`,
    `path=${loaded.path ?? "none"}`,
    `admins=${loaded.config.adminActors.join(",") || "none"}`,
    `runners=${loaded.config.runActors.join(",") || "none"}`,
    `approvers=${loaded.config.approverActors.join(",") || "none"}`,
    `status=${loaded.config.statusActors.join(",") || "none"}`,
    `live=${loaded.config.liveActors.join(",") || "none"}`,
  ].join(" | ");
}
