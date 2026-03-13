import { z } from "zod";

export type JsonSchema =
  | {
      type: "object";
      required?: string[];
      properties?: Record<string, JsonSchema>;
      additionalProperties?: boolean;
      nullable?: boolean;
    }
  | {
      type: "array";
      items?: JsonSchema;
      nullable?: boolean;
    }
  | {
      type: "string" | "number" | "boolean" | "null";
      enum?: readonly string[];
      nullable?: boolean;
    };

function validateJsonSchemaValue(schema: JsonSchema, value: unknown, path = "$"): string[] {
  if (value === null) {
    if ("nullable" in schema && schema.nullable) return [];
    return schema.type === "null" ? [] : [`${path}: expected ${schema.type}, received null`];
  }

  if (schema.type === "string") {
    if (typeof value !== "string") return [`${path}: expected string, received ${typeof value}`];
    if (schema.enum && !schema.enum.includes(value)) {
      return [`${path}: expected one of ${schema.enum.join(", ")}, received ${value}`];
    }
    return [];
  }

  if (schema.type === "number") {
    return typeof value === "number" ? [] : [`${path}: expected number, received ${typeof value}`];
  }

  if (schema.type === "boolean") {
    return typeof value === "boolean" ? [] : [`${path}: expected boolean, received ${typeof value}`];
  }

  if (schema.type === "null") {
    return value === null ? [] : [`${path}: expected null, received ${typeof value}`];
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array, received ${typeof value}`];
    if (!schema.items) return [];
    return value.flatMap((item, index) => validateJsonSchemaValue(schema.items!, item, `${path}[${index}]`));
  }

  if (schema.type !== "object") {
    return [`${path}: unsupported schema type ${schema.type}`];
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return [`${path}: expected object, received ${Array.isArray(value) ? "array" : typeof value}`];
  }

  const record = value as Record<string, unknown>;
  const issues: string[] = [];
  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in record)) {
      issues.push(`${path}.${requiredKey}: missing required property`);
    }
  }
  for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
    if (!(key in record)) continue;
    issues.push(...validateJsonSchemaValue(childSchema, record[key], `${path}.${key}`));
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!schema.properties || !(key in schema.properties)) {
        issues.push(`${path}.${key}: unexpected property`);
      }
    }
  }
  return issues;
}

export function parseWithDualValidation<T>(params: {
  schemaName: string;
  zodSchema: z.ZodType<T>;
  jsonSchema: JsonSchema;
  data: unknown;
}) {
  const jsonIssues = validateJsonSchemaValue(params.jsonSchema, params.data);
  if (jsonIssues.length > 0) {
    throw new Error(`${params.schemaName} JSON schema validation failed: ${jsonIssues.join("; ")}`);
  }
  const parsed = params.zodSchema.safeParse(params.data);
  if (!parsed.success) {
    throw new Error(
      `${params.schemaName} zod validation failed: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "$"} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

const validationResultSchema = z.object({
  command: z.string(),
  status: z.enum(["passed", "failed", "skipped", "not_run"]),
  output: z.string().nullable().default(null),
});

const executionArtifactSchema = z.object({
  kind: z.string(),
  label: z.string(),
  path: z.string().nullable().default(null),
  value: z.string().nullable().default(null),
});

const ciJobSummarySchema = z.object({
  name: z.string(),
  status: z.enum(["success", "failure", "skipped", "in_progress", "not_run"]),
  details: z.string().nullable().default(null),
});

export const ciStatusSummarySchema = z.object({
  provider: z.enum(["github", "mock", "none"]),
  workflowName: z.string(),
  runId: z.string().nullable().default(null),
  status: z.enum(["success", "failure", "skipped", "in_progress", "not_run"]),
  jobs: z.array(ciJobSummarySchema),
  summary: z.string(),
});

export const executionReportSchema = z.object({
  iterationNumber: z.number().int().nonnegative(),
  changedFiles: z.array(z.string()),
  checkedButUnmodifiedFiles: z.array(z.string()),
  summaryOfChanges: z.array(z.string()),
  whyThisWasDone: z.array(z.string()),
  howBehaviorWasKeptStable: z.array(z.string()),
  localValidation: z.array(validationResultSchema),
  ciValidation: ciStatusSummarySchema.nullable().default(null),
  blockers: z.array(z.string()),
  risks: z.array(z.string()),
  recommendedNextStep: z.string(),
  shouldCloseSlice: z.boolean(),
  artifacts: z.array(executionArtifactSchema),
  rawExecutorOutput: z.unknown().optional(),
});

export const plannerDecisionSchema = z.object({
  sliceLevel: z.enum(["small", "medium", "large"]),
  rationale: z.array(z.string()),
  sameAcceptanceSuite: z.boolean(),
  objective: z.string(),
  subtasks: z.array(z.string()),
  allowedFiles: z.array(z.string()),
  forbiddenFiles: z.array(z.string()),
  mustDo: z.array(z.string()),
  mustNotDo: z.array(z.string()),
  acceptanceCommands: z.array(z.string()),
  successCriteria: z.array(z.string()),
  ifNotSuitableWhy: z.string().nullable().default(null),
  nextPrompt: z.string(),
});

export const reviewVerdictSchema = z.object({
  verdict: z.enum(["accept", "revise", "stop", "escalate"]),
  reasons: z.array(z.string()),
  violatedConstraints: z.array(z.string()),
  missingValidation: z.array(z.string()),
  suggestedPatchScope: z.array(z.string()),
  canAutoContinue: z.boolean(),
});

export const providerKindSchema = z.enum(["rule_based", "openai"]);
export const executorProviderSchema = z.enum(["mock", "local_repo", "openai_responses"]);
export const executionModeSchema = z.enum(["mock", "dry_run", "apply"]);
export const executorFallbackModeSchema = z.enum(["blocked", "mock", "local_repo"]);
export const patchStatusSchema = z.enum([
  "none",
  "plan_ready",
  "patch_ready",
  "patch_exported",
  "branch_ready",
  "promotion_ready",
  "waiting_approval",
  "approved_for_apply",
  "applied",
  "promoted",
  "rejected",
]);
export const approvalStatusSchema = z.enum(["not_requested", "pending_plan", "pending_patch", "approved", "rejected"]);
export const artifactPruneStatusSchema = z.enum(["not_run", "pruned", "skipped", "failed"]);
export const liveSmokeStatusSchema = z.enum(["not_run", "skipped", "passed", "failed", "blocked"]);
export const promotionStatusSchema = z.enum(["not_ready", "patch_exported", "branch_ready", "promotion_ready", "promoted", "rejected"]);
export const workspaceStatusSchema = z.enum(["unknown", "clean", "active", "stale", "orphaned", "cleaned"]);
export const liveAcceptanceStatusSchema = z.enum(["not_run", "skipped", "passed", "failed", "blocked"]);
export const livePassStatusSchema = z.enum(["not_run", "skipped", "passed", "failed", "blocked"]);
export const handoffStatusSchema = z.enum(["not_ready", "exported", "handoff_ready", "branch_published", "handoff_failed"]);
export const prDraftStatusSchema = z.enum(["not_ready", "metadata_ready", "payload_ready", "skipped", "failed"]);

export const artifactPruneResultSchema = z.object({
  status: artifactPruneStatusSchema,
  retainedIterations: z.array(z.number().int().positive()),
  deletedPaths: z.array(z.string()),
  skippedReasons: z.array(z.string()).default([]),
  summary: z.string(),
  prunedAt: z.string(),
});

export const liveSmokeResultSchema = z.object({
  status: liveSmokeStatusSchema,
  reason: z.string(),
  provider: z.string(),
  model: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  reportPath: z.string().nullable().default(null),
  diffPath: z.string().nullable().default(null),
  transcriptSummaryPath: z.string().nullable().default(null),
  toolLogPath: z.string().nullable().default(null),
  commandLogPath: z.string().nullable().default(null),
  ranAt: z.string(),
});

export const cleanupDecisionSchema = z.object({
  workspaceStatus: workspaceStatusSchema,
  deletedPaths: z.array(z.string()),
  retainedPaths: z.array(z.string()),
  orphanPaths: z.array(z.string()).default([]),
  stalePaths: z.array(z.string()).default([]),
  summary: z.string(),
  cleanedAt: z.string(),
});

export const prDraftMetadataSchema = z.object({
  title: z.string(),
  body: z.string(),
  changeSummary: z.array(z.string()).default([]),
  validationSummary: z.array(z.string()).default([]),
  knownRisks: z.array(z.string()).default([]),
  approvalNotes: z.array(z.string()).default([]),
  branchName: z.string().nullable().default(null),
  payloadPath: z.string().nullable().default(null),
  githubHandoffStatus: z.enum(["not_requested", "skipped", "payload_ready", "failed"]).default("not_requested"),
  githubHandoffReason: z.string().nullable().default(null),
  createdAt: z.string(),
});

export const githubHandoffResultSchema = z.object({
  status: z.enum(["not_requested", "skipped", "payload_only", "draft_created", "failed"]).default("not_requested"),
  provider: z.string(),
  targetBranch: z.string().nullable().default(null),
  draftUrl: z.string().nullable().default(null),
  summary: z.string(),
  requestPayloadPath: z.string().nullable().default(null),
  ranAt: z.string(),
});

export const liveEvidenceSchema = z.object({
  provider: z.string(),
  model: z.string().nullable().default(null),
  status: liveSmokeStatusSchema,
  reason: z.string(),
  summary: z.string().nullable().default(null),
  startedAt: z.string(),
  endedAt: z.string(),
  toolCallCount: z.number().int().nonnegative().default(0),
  commandCount: z.number().int().nonnegative().default(0),
  reportPath: z.string().nullable().default(null),
  diffPath: z.string().nullable().default(null),
  transcriptSummaryPath: z.string().nullable().default(null),
  toolLogPath: z.string().nullable().default(null),
  commandLogPath: z.string().nullable().default(null),
  patchArtifactPath: z.string().nullable().default(null),
});

export const auditTrailSchema = z.object({
  iterationNumber: z.number().int().positive(),
  stateStatus: z.enum([
    "draft",
    "planning",
    "waiting_approval",
    "executing",
    "awaiting_result",
    "validating",
    "ci_running",
    "needs_revision",
    "blocked",
    "completed",
    "stopped",
  ]),
  patchStatus: patchStatusSchema,
  promotionStatus: promotionStatusSchema,
  handoffStatus: handoffStatusSchema,
  liveAcceptanceStatus: liveAcceptanceStatusSchema,
  livePassStatus: livePassStatusSchema,
  summary: z.string(),
  artifactPaths: z.array(z.string()).default([]),
  createdAt: z.string(),
});

const promotionConfigSchema = z.object({
  branchNameTemplate: z.string().default("orchestrator/{taskId}/iter-{iteration}"),
  baseBranch: z.string().default("main"),
  allowPublish: z.boolean().default(false),
  approvalRequired: z.boolean().default(true),
  allowApplyWorkspace: z.boolean().default(false),
  requirePatchExport: z.boolean().default(true),
});

const retentionConfigSchema = z.object({
  recentSuccessKeep: z.number().int().nonnegative().default(3),
  recentFailureKeep: z.number().int().nonnegative().default(5),
  staleWorkspaceTtlMinutes: z.number().int().positive().default(120),
  orphanArtifactTtlMinutes: z.number().int().positive().default(240),
  preserveApprovalPending: z.boolean().default(true),
});

export const orchestratorStatusSchema = z.enum([
  "draft",
  "planning",
  "waiting_approval",
  "executing",
  "awaiting_result",
  "validating",
  "ci_running",
  "needs_revision",
  "blocked",
  "completed",
  "stopped",
]);

const orchestratorTaskSchema = z.object({
  userGoal: z.string(),
  repoPath: z.string(),
  repoName: z.string(),
  allowedFiles: z.array(z.string()),
  forbiddenFiles: z.array(z.string()),
  acceptanceGates: z.array(z.string()),
  maxIterations: z.number().int().positive(),
  maxConsecutiveFailures: z.number().int().positive(),
  autoMode: z.boolean(),
  approvalMode: z.enum(["auto", "human_approval"]),
  objective: z.string(),
  subtasks: z.array(z.string()),
  successCriteria: z.array(z.string()),
  sameBoundary: z.boolean().default(true),
  specsClear: z.boolean().default(true),
  sameAcceptanceSuite: z.boolean().default(true),
  executorMode: executorProviderSchema.default("mock"),
  executionMode: executionModeSchema.default("mock"),
  executorFallbackMode: executorFallbackModeSchema.default("blocked"),
  workspaceRoot: z.string().nullable().default(null),
  executorCommand: z.array(z.string()).default([]),
  plannerProvider: providerKindSchema.default("rule_based"),
  reviewerProvider: providerKindSchema.default("rule_based"),
  artifactRetentionSuccess: z.number().int().positive().default(3),
  artifactRetentionFailure: z.number().int().positive().default(5),
  promotionConfig: promotionConfigSchema.default({
    branchNameTemplate: "orchestrator/{taskId}/iter-{iteration}",
    baseBranch: "main",
    allowPublish: false,
    approvalRequired: true,
    allowApplyWorkspace: false,
    requirePatchExport: true,
  }),
  retentionConfig: retentionConfigSchema.default({
    recentSuccessKeep: 3,
    recentFailureKeep: 5,
    staleWorkspaceTtlMinutes: 120,
    orphanArtifactTtlMinutes: 240,
    preserveApprovalPending: true,
  }),
});

export const nextIterationPlanSchema = z.object({
  iterationNumber: z.number().int().positive(),
  plannerDecision: plannerDecisionSchema,
  approvalRequired: z.boolean(),
  executorMode: executorProviderSchema,
  executionMode: executionModeSchema,
});

export const iterationRecordSchema = z.object({
  iterationNumber: z.number().int().positive(),
  plannerProviderRequested: providerKindSchema,
  plannerProviderResolved: providerKindSchema,
  plannerFallbackReason: z.string().nullable().default(null),
  executorProviderRequested: executorProviderSchema.nullable().default(null),
  executorProviderResolved: executorProviderSchema.nullable().default(null),
  executorFallbackReason: z.string().nullable().default(null),
  executionMode: executionModeSchema.nullable().default(null),
  reviewerProviderRequested: providerKindSchema.nullable().default(null),
  reviewerProviderResolved: providerKindSchema.nullable().default(null),
  reviewerFallbackReason: z.string().nullable().default(null),
  plannerDecision: plannerDecisionSchema.nullable().default(null),
  executionReport: executionReportSchema.nullable().default(null),
  reviewVerdict: reviewVerdictSchema.nullable().default(null),
  ciSummary: ciStatusSummarySchema.nullable().default(null),
  patchStatus: patchStatusSchema.default("none"),
  approvalStatus: approvalStatusSchema.default("not_requested"),
  promotionStatus: promotionStatusSchema.default("not_ready"),
  liveAcceptanceStatus: liveAcceptanceStatusSchema.default("not_run"),
  livePassStatus: livePassStatusSchema.default("not_run"),
  workspaceStatus: workspaceStatusSchema.default("unknown"),
  exportArtifactPaths: z.array(z.string()).default([]),
  handoffStatus: handoffStatusSchema.default("not_ready"),
  prDraftStatus: prDraftStatusSchema.default("not_ready"),
  handoffArtifactPaths: z.array(z.string()).default([]),
  artifactPruneResult: artifactPruneResultSchema.nullable().default(null),
  cleanupDecision: cleanupDecisionSchema.nullable().default(null),
  auditTrailPath: z.string().nullable().default(null),
  liveEvidencePath: z.string().nullable().default(null),
  githubHandoffResultPath: z.string().nullable().default(null),
  stateBefore: orchestratorStatusSchema,
  stateAfter: orchestratorStatusSchema,
  stopReason: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const orchestratorStateSchema = z.object({
  id: z.string(),
  status: orchestratorStatusSchema,
  iterationNumber: z.number().int().nonnegative(),
  consecutiveFailures: z.number().int().nonnegative(),
  repeatedNoProgressCount: z.number().int().nonnegative().default(0),
  pendingHumanApproval: z.boolean().default(false),
  task: orchestratorTaskSchema,
  plannerDecision: plannerDecisionSchema.nullable().default(null),
  nextIterationPlan: nextIterationPlanSchema.nullable().default(null),
  lastExecutionReport: executionReportSchema.nullable().default(null),
  lastReviewVerdict: reviewVerdictSchema.nullable().default(null),
  lastCIStatus: ciStatusSummarySchema.nullable().default(null),
  lastPlannerProvider: providerKindSchema.nullable().default(null),
  lastReviewerProvider: providerKindSchema.nullable().default(null),
  lastPlannerFallbackReason: z.string().nullable().default(null),
  lastReviewerFallbackReason: z.string().nullable().default(null),
  patchStatus: patchStatusSchema.default("none"),
  approvalStatus: approvalStatusSchema.default("not_requested"),
  promotionStatus: promotionStatusSchema.default("not_ready"),
  workspaceStatus: workspaceStatusSchema.default("unknown"),
  liveAcceptanceStatus: liveAcceptanceStatusSchema.default("not_run"),
  livePassStatus: livePassStatusSchema.default("not_run"),
  exportArtifactPaths: z.array(z.string()).default([]),
  handoffStatus: handoffStatusSchema.default("not_ready"),
  prDraftStatus: prDraftStatusSchema.default("not_ready"),
  handoffArtifactPaths: z.array(z.string()).default([]),
  lastArtifactPruneResult: artifactPruneResultSchema.nullable().default(null),
  lastLiveSmokeResult: liveSmokeResultSchema.nullable().default(null),
  lastLiveAcceptanceResult: liveSmokeResultSchema.nullable().default(null),
  lastCleanupDecision: cleanupDecisionSchema.nullable().default(null),
  lastPrDraftMetadata: prDraftMetadataSchema.nullable().default(null),
  lastGitHubHandoffResult: githubHandoffResultSchema.nullable().default(null),
  lastLiveEvidence: liveEvidenceSchema.nullable().default(null),
  lastAuditTrail: auditTrailSchema.nullable().default(null),
  lastHandoffPackagePath: z.string().nullable().default(null),
  stopReason: z.string().nullable().default(null),
  iterationHistory: z.array(iterationRecordSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ExecutionReport = z.infer<typeof executionReportSchema>;
export type PlannerDecision = z.infer<typeof plannerDecisionSchema>;
export type NextIterationPlan = z.infer<typeof nextIterationPlanSchema>;
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type OrchestratorState = z.infer<typeof orchestratorStateSchema>;
export type CIStatusSummary = z.infer<typeof ciStatusSummarySchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
export type PlannerProviderKind = z.infer<typeof providerKindSchema>;
export type IterationRecord = z.infer<typeof iterationRecordSchema>;
export type ExecutorProviderKind = z.infer<typeof executorProviderSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type ExecutorFallbackMode = z.infer<typeof executorFallbackModeSchema>;
export type PatchStatus = z.infer<typeof patchStatusSchema>;
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type ArtifactPruneResult = z.infer<typeof artifactPruneResultSchema>;
export type LiveSmokeResult = z.infer<typeof liveSmokeResultSchema>;
export type CleanupDecision = z.infer<typeof cleanupDecisionSchema>;
export type PrDraftMetadata = z.infer<typeof prDraftMetadataSchema>;
export type GitHubHandoffResult = z.infer<typeof githubHandoffResultSchema>;
export type LiveEvidence = z.infer<typeof liveEvidenceSchema>;
export type AuditTrail = z.infer<typeof auditTrailSchema>;

const stringArrayJsonSchema: JsonSchema = {
  type: "array",
  items: { type: "string" },
};

export const executionReportJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "iterationNumber",
    "changedFiles",
    "checkedButUnmodifiedFiles",
    "summaryOfChanges",
    "whyThisWasDone",
    "howBehaviorWasKeptStable",
    "localValidation",
    "ciValidation",
    "blockers",
    "risks",
    "recommendedNextStep",
    "shouldCloseSlice",
    "artifacts",
  ],
  properties: {
    iterationNumber: { type: "number" },
    changedFiles: stringArrayJsonSchema,
    checkedButUnmodifiedFiles: stringArrayJsonSchema,
    summaryOfChanges: stringArrayJsonSchema,
    whyThisWasDone: stringArrayJsonSchema,
    howBehaviorWasKeptStable: stringArrayJsonSchema,
    localValidation: {
      type: "array",
      items: {
        type: "object",
        required: ["command", "status"],
        additionalProperties: false,
        properties: {
          command: { type: "string" },
          status: { type: "string", enum: ["passed", "failed", "skipped", "not_run"] },
          output: { type: "string", nullable: true },
        },
      },
    },
    ciValidation: {
      type: "object",
      nullable: true,
      required: ["provider", "workflowName", "runId", "status", "jobs", "summary"],
      additionalProperties: false,
      properties: {
        provider: { type: "string", enum: ["github", "mock", "none"] },
        workflowName: { type: "string" },
        runId: { type: "string", nullable: true },
        status: { type: "string", enum: ["success", "failure", "skipped", "in_progress", "not_run"] },
        jobs: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "status", "details"],
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              status: { type: "string", enum: ["success", "failure", "skipped", "in_progress", "not_run"] },
              details: { type: "string", nullable: true },
            },
          },
        },
        summary: { type: "string" },
      },
    },
    blockers: stringArrayJsonSchema,
    risks: stringArrayJsonSchema,
    recommendedNextStep: { type: "string" },
    shouldCloseSlice: { type: "boolean" },
    artifacts: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "label", "path", "value"],
        additionalProperties: false,
        properties: {
          kind: { type: "string" },
          label: { type: "string" },
          path: { type: "string", nullable: true },
          value: { type: "string", nullable: true },
        },
      },
    },
    rawExecutorOutput: { type: "object", nullable: true },
  },
};

export const plannerDecisionJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "sliceLevel",
    "rationale",
    "sameAcceptanceSuite",
    "objective",
    "subtasks",
    "allowedFiles",
    "forbiddenFiles",
    "mustDo",
    "mustNotDo",
    "acceptanceCommands",
    "successCriteria",
    "ifNotSuitableWhy",
    "nextPrompt",
  ],
  properties: {
    sliceLevel: { type: "string", enum: ["small", "medium", "large"] },
    rationale: stringArrayJsonSchema,
    sameAcceptanceSuite: { type: "boolean" },
    objective: { type: "string" },
    subtasks: stringArrayJsonSchema,
    allowedFiles: stringArrayJsonSchema,
    forbiddenFiles: stringArrayJsonSchema,
    mustDo: stringArrayJsonSchema,
    mustNotDo: stringArrayJsonSchema,
    acceptanceCommands: stringArrayJsonSchema,
    successCriteria: stringArrayJsonSchema,
    ifNotSuitableWhy: { type: "string", nullable: true },
    nextPrompt: { type: "string" },
  },
};

export const reviewVerdictJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "reasons", "violatedConstraints", "missingValidation", "suggestedPatchScope", "canAutoContinue"],
  properties: {
    verdict: { type: "string", enum: ["accept", "revise", "stop", "escalate"] },
    reasons: stringArrayJsonSchema,
    violatedConstraints: stringArrayJsonSchema,
    missingValidation: stringArrayJsonSchema,
    suggestedPatchScope: stringArrayJsonSchema,
    canAutoContinue: { type: "boolean" },
  },
};

export const ciStatusSummaryJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["provider", "workflowName", "runId", "status", "jobs", "summary"],
  properties: {
    provider: { type: "string", enum: ["github", "mock", "none"] },
    workflowName: { type: "string" },
    runId: { type: "string", nullable: true },
    status: { type: "string", enum: ["success", "failure", "skipped", "in_progress", "not_run"] },
    jobs: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "status", "details"],
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          status: { type: "string", enum: ["success", "failure", "skipped", "in_progress", "not_run"] },
          details: { type: "string", nullable: true },
        },
      },
    },
    summary: { type: "string" },
  },
};

export const orchestratorStateJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "status",
    "iterationNumber",
    "consecutiveFailures",
    "repeatedNoProgressCount",
    "pendingHumanApproval",
    "task",
    "plannerDecision",
    "nextIterationPlan",
    "lastExecutionReport",
    "lastReviewVerdict",
    "lastCIStatus",
    "lastPlannerProvider",
    "lastReviewerProvider",
    "lastPlannerFallbackReason",
    "lastReviewerFallbackReason",
    "patchStatus",
    "approvalStatus",
    "promotionStatus",
    "workspaceStatus",
    "liveAcceptanceStatus",
    "livePassStatus",
    "exportArtifactPaths",
    "handoffStatus",
    "prDraftStatus",
    "handoffArtifactPaths",
    "lastArtifactPruneResult",
    "lastLiveSmokeResult",
    "lastLiveAcceptanceResult",
    "lastCleanupDecision",
    "lastPrDraftMetadata",
    "lastGitHubHandoffResult",
    "lastLiveEvidence",
    "lastAuditTrail",
    "lastHandoffPackagePath",
    "stopReason",
    "iterationHistory",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    status: {
      type: "string",
      enum: [
        "draft",
        "planning",
        "waiting_approval",
        "executing",
        "awaiting_result",
        "validating",
        "ci_running",
        "needs_revision",
        "blocked",
        "completed",
        "stopped",
      ],
    },
    iterationNumber: { type: "number" },
    consecutiveFailures: { type: "number" },
    repeatedNoProgressCount: { type: "number" },
    pendingHumanApproval: { type: "boolean" },
    task: {
      type: "object",
      required: [
        "userGoal",
        "repoPath",
        "repoName",
        "allowedFiles",
        "forbiddenFiles",
        "acceptanceGates",
        "maxIterations",
        "maxConsecutiveFailures",
        "autoMode",
        "approvalMode",
        "objective",
        "subtasks",
        "successCriteria",
        "sameBoundary",
        "specsClear",
        "sameAcceptanceSuite",
        "executorMode",
        "executionMode",
        "executorFallbackMode",
        "workspaceRoot",
        "executorCommand",
        "plannerProvider",
        "reviewerProvider",
        "artifactRetentionSuccess",
        "artifactRetentionFailure",
        "promotionConfig",
        "retentionConfig",
      ],
      additionalProperties: false,
      properties: {
        userGoal: { type: "string" },
        repoPath: { type: "string" },
        repoName: { type: "string" },
        allowedFiles: stringArrayJsonSchema,
        forbiddenFiles: stringArrayJsonSchema,
        acceptanceGates: stringArrayJsonSchema,
        maxIterations: { type: "number" },
        maxConsecutiveFailures: { type: "number" },
        autoMode: { type: "boolean" },
        approvalMode: { type: "string", enum: ["auto", "human_approval"] },
        objective: { type: "string" },
        subtasks: stringArrayJsonSchema,
        successCriteria: stringArrayJsonSchema,
        sameBoundary: { type: "boolean" },
        specsClear: { type: "boolean" },
        sameAcceptanceSuite: { type: "boolean" },
        executorMode: { type: "string", enum: ["mock", "local_repo", "openai_responses"] },
        executionMode: { type: "string", enum: ["mock", "dry_run", "apply"] },
        executorFallbackMode: { type: "string", enum: ["blocked", "mock", "local_repo"] },
        workspaceRoot: { type: "string", nullable: true },
        executorCommand: { type: "array", items: { type: "string" } },
        plannerProvider: { type: "string", enum: ["rule_based", "openai"] },
        reviewerProvider: { type: "string", enum: ["rule_based", "openai"] },
        artifactRetentionSuccess: { type: "number" },
        artifactRetentionFailure: { type: "number" },
        promotionConfig: {
          type: "object",
          required: [
            "branchNameTemplate",
            "baseBranch",
            "allowPublish",
            "approvalRequired",
            "allowApplyWorkspace",
            "requirePatchExport",
          ],
          additionalProperties: false,
          properties: {
            branchNameTemplate: { type: "string" },
            baseBranch: { type: "string" },
            allowPublish: { type: "boolean" },
            approvalRequired: { type: "boolean" },
            allowApplyWorkspace: { type: "boolean" },
            requirePatchExport: { type: "boolean" },
          },
        },
        retentionConfig: {
          type: "object",
          required: [
            "recentSuccessKeep",
            "recentFailureKeep",
            "staleWorkspaceTtlMinutes",
            "orphanArtifactTtlMinutes",
            "preserveApprovalPending",
          ],
          additionalProperties: false,
          properties: {
            recentSuccessKeep: { type: "number" },
            recentFailureKeep: { type: "number" },
            staleWorkspaceTtlMinutes: { type: "number" },
            orphanArtifactTtlMinutes: { type: "number" },
            preserveApprovalPending: { type: "boolean" },
          },
        },
      },
    },
    plannerDecision: { ...plannerDecisionJsonSchema, nullable: true },
    nextIterationPlan: {
      type: "object",
      nullable: true,
      required: ["iterationNumber", "plannerDecision", "approvalRequired", "executorMode", "executionMode"],
      additionalProperties: false,
      properties: {
        iterationNumber: { type: "number" },
        plannerDecision: plannerDecisionJsonSchema,
        approvalRequired: { type: "boolean" },
        executorMode: { type: "string", enum: ["mock", "local_repo", "openai_responses"] },
        executionMode: { type: "string", enum: ["mock", "dry_run", "apply"] },
      },
    },
    lastExecutionReport: { ...executionReportJsonSchema, nullable: true },
    lastReviewVerdict: { ...reviewVerdictJsonSchema, nullable: true },
    lastCIStatus: { ...ciStatusSummaryJsonSchema, nullable: true },
    lastPlannerProvider: { type: "string", enum: ["rule_based", "openai"], nullable: true },
    lastReviewerProvider: { type: "string", enum: ["rule_based", "openai"], nullable: true },
    lastPlannerFallbackReason: { type: "string", nullable: true },
    lastReviewerFallbackReason: { type: "string", nullable: true },
    patchStatus: {
      type: "string",
      enum: ["none", "plan_ready", "patch_ready", "patch_exported", "branch_ready", "promotion_ready", "waiting_approval", "approved_for_apply", "applied", "promoted", "rejected"],
    },
    approvalStatus: {
      type: "string",
      enum: ["not_requested", "pending_plan", "pending_patch", "approved", "rejected"],
    },
    promotionStatus: {
      type: "string",
      enum: ["not_ready", "patch_exported", "branch_ready", "promotion_ready", "promoted", "rejected"],
    },
    workspaceStatus: {
      type: "string",
      enum: ["unknown", "clean", "active", "stale", "orphaned", "cleaned"],
    },
    liveAcceptanceStatus: {
      type: "string",
      enum: ["not_run", "skipped", "passed", "failed", "blocked"],
    },
    livePassStatus: {
      type: "string",
      enum: ["not_run", "skipped", "passed", "failed", "blocked"],
    },
    exportArtifactPaths: { type: "array", items: { type: "string" } },
    handoffStatus: {
      type: "string",
      enum: ["not_ready", "exported", "handoff_ready", "branch_published", "handoff_failed"],
    },
    prDraftStatus: {
      type: "string",
      enum: ["not_ready", "metadata_ready", "payload_ready", "skipped", "failed"],
    },
    handoffArtifactPaths: { type: "array", items: { type: "string" } },
    lastArtifactPruneResult: {
      type: "object",
      nullable: true,
      required: ["status", "retainedIterations", "deletedPaths", "skippedReasons", "summary", "prunedAt"],
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["not_run", "pruned", "skipped", "failed"] },
        retainedIterations: { type: "array", items: { type: "number" } },
        deletedPaths: { type: "array", items: { type: "string" } },
        skippedReasons: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        prunedAt: { type: "string" },
      },
    },
    lastLiveSmokeResult: {
      type: "object",
      nullable: true,
      required: ["status", "reason", "provider", "model", "summary", "reportPath", "diffPath", "transcriptSummaryPath", "toolLogPath", "commandLogPath", "ranAt"],
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["not_run", "skipped", "passed", "failed", "blocked"] },
        reason: { type: "string" },
        provider: { type: "string" },
        model: { type: "string", nullable: true },
        summary: { type: "string", nullable: true },
        reportPath: { type: "string", nullable: true },
        diffPath: { type: "string", nullable: true },
        transcriptSummaryPath: { type: "string", nullable: true },
        toolLogPath: { type: "string", nullable: true },
        commandLogPath: { type: "string", nullable: true },
        ranAt: { type: "string" },
      },
    },
    lastLiveAcceptanceResult: {
      type: "object",
      nullable: true,
      required: ["status", "reason", "provider", "model", "summary", "reportPath", "diffPath", "transcriptSummaryPath", "toolLogPath", "commandLogPath", "ranAt"],
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["not_run", "skipped", "passed", "failed", "blocked"] },
        reason: { type: "string" },
        provider: { type: "string" },
        model: { type: "string", nullable: true },
        summary: { type: "string", nullable: true },
        reportPath: { type: "string", nullable: true },
        diffPath: { type: "string", nullable: true },
        transcriptSummaryPath: { type: "string", nullable: true },
        toolLogPath: { type: "string", nullable: true },
        commandLogPath: { type: "string", nullable: true },
        ranAt: { type: "string" },
      },
    },
    lastCleanupDecision: {
      type: "object",
      nullable: true,
      required: ["workspaceStatus", "deletedPaths", "retainedPaths", "orphanPaths", "stalePaths", "summary", "cleanedAt"],
      additionalProperties: false,
      properties: {
        workspaceStatus: { type: "string", enum: ["unknown", "clean", "active", "stale", "orphaned", "cleaned"] },
        deletedPaths: { type: "array", items: { type: "string" } },
        retainedPaths: { type: "array", items: { type: "string" } },
        orphanPaths: { type: "array", items: { type: "string" } },
        stalePaths: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        cleanedAt: { type: "string" },
      },
    },
    lastPrDraftMetadata: {
      type: "object",
      nullable: true,
      required: ["title", "body", "changeSummary", "validationSummary", "knownRisks", "approvalNotes", "branchName", "payloadPath", "githubHandoffStatus", "githubHandoffReason", "createdAt"],
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        changeSummary: { type: "array", items: { type: "string" } },
        validationSummary: { type: "array", items: { type: "string" } },
        knownRisks: { type: "array", items: { type: "string" } },
        approvalNotes: { type: "array", items: { type: "string" } },
        branchName: { type: "string", nullable: true },
        payloadPath: { type: "string", nullable: true },
        githubHandoffStatus: { type: "string", enum: ["not_requested", "skipped", "payload_ready", "failed"] },
        githubHandoffReason: { type: "string", nullable: true },
        createdAt: { type: "string" },
      },
    },
    lastGitHubHandoffResult: {
      type: "object",
      nullable: true,
      required: ["status", "provider", "targetBranch", "draftUrl", "summary", "requestPayloadPath", "ranAt"],
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["not_requested", "skipped", "payload_only", "draft_created", "failed"] },
        provider: { type: "string" },
        targetBranch: { type: "string", nullable: true },
        draftUrl: { type: "string", nullable: true },
        summary: { type: "string" },
        requestPayloadPath: { type: "string", nullable: true },
        ranAt: { type: "string" },
      },
    },
    lastLiveEvidence: {
      type: "object",
      nullable: true,
      required: [
        "provider",
        "model",
        "status",
        "reason",
        "summary",
        "startedAt",
        "endedAt",
        "toolCallCount",
        "commandCount",
        "reportPath",
        "diffPath",
        "transcriptSummaryPath",
        "toolLogPath",
        "commandLogPath",
        "patchArtifactPath",
      ],
      additionalProperties: false,
      properties: {
        provider: { type: "string" },
        model: { type: "string", nullable: true },
        status: { type: "string", enum: ["not_run", "skipped", "passed", "failed", "blocked"] },
        reason: { type: "string" },
        summary: { type: "string", nullable: true },
        startedAt: { type: "string" },
        endedAt: { type: "string" },
        toolCallCount: { type: "number" },
        commandCount: { type: "number" },
        reportPath: { type: "string", nullable: true },
        diffPath: { type: "string", nullable: true },
        transcriptSummaryPath: { type: "string", nullable: true },
        toolLogPath: { type: "string", nullable: true },
        commandLogPath: { type: "string", nullable: true },
        patchArtifactPath: { type: "string", nullable: true },
      },
    },
    lastAuditTrail: {
      type: "object",
      nullable: true,
      required: ["iterationNumber", "stateStatus", "patchStatus", "promotionStatus", "handoffStatus", "liveAcceptanceStatus", "livePassStatus", "summary", "artifactPaths", "createdAt"],
      additionalProperties: false,
      properties: {
        iterationNumber: { type: "number" },
        stateStatus: {
          type: "string",
          enum: ["draft", "planning", "waiting_approval", "executing", "awaiting_result", "validating", "ci_running", "needs_revision", "blocked", "completed", "stopped"],
        },
        patchStatus: {
          type: "string",
          enum: ["none", "plan_ready", "patch_ready", "patch_exported", "branch_ready", "promotion_ready", "waiting_approval", "approved_for_apply", "applied", "promoted", "rejected"],
        },
        promotionStatus: {
          type: "string",
          enum: ["not_ready", "patch_exported", "branch_ready", "promotion_ready", "promoted", "rejected"],
        },
        handoffStatus: {
          type: "string",
          enum: ["not_ready", "exported", "handoff_ready", "branch_published", "handoff_failed"],
        },
        liveAcceptanceStatus: {
          type: "string",
          enum: ["not_run", "skipped", "passed", "failed", "blocked"],
        },
        livePassStatus: {
          type: "string",
          enum: ["not_run", "skipped", "passed", "failed", "blocked"],
        },
        summary: { type: "string" },
        artifactPaths: { type: "array", items: { type: "string" } },
        createdAt: { type: "string" },
      },
    },
    lastHandoffPackagePath: { type: "string", nullable: true },
    stopReason: { type: "string", nullable: true },
    iterationHistory: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "iterationNumber",
          "plannerProviderRequested",
          "plannerProviderResolved",
          "plannerFallbackReason",
          "executorProviderRequested",
          "executorProviderResolved",
          "executorFallbackReason",
          "executionMode",
          "reviewerProviderRequested",
          "reviewerProviderResolved",
          "reviewerFallbackReason",
          "plannerDecision",
          "executionReport",
          "reviewVerdict",
          "ciSummary",
          "patchStatus",
          "approvalStatus",
          "promotionStatus",
          "liveAcceptanceStatus",
          "livePassStatus",
          "workspaceStatus",
          "exportArtifactPaths",
          "handoffStatus",
          "prDraftStatus",
          "handoffArtifactPaths",
          "artifactPruneResult",
          "cleanupDecision",
          "auditTrailPath",
          "liveEvidencePath",
          "githubHandoffResultPath",
          "stateBefore",
          "stateAfter",
          "stopReason",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          iterationNumber: { type: "number" },
          plannerProviderRequested: { type: "string", enum: ["rule_based", "openai"] },
          plannerProviderResolved: { type: "string", enum: ["rule_based", "openai"] },
          plannerFallbackReason: { type: "string", nullable: true },
          executorProviderRequested: { type: "string", enum: ["mock", "local_repo", "openai_responses"], nullable: true },
          executorProviderResolved: { type: "string", enum: ["mock", "local_repo", "openai_responses"], nullable: true },
          executorFallbackReason: { type: "string", nullable: true },
          executionMode: { type: "string", enum: ["mock", "dry_run", "apply"], nullable: true },
          reviewerProviderRequested: { type: "string", enum: ["rule_based", "openai"], nullable: true },
          reviewerProviderResolved: { type: "string", enum: ["rule_based", "openai"], nullable: true },
          reviewerFallbackReason: { type: "string", nullable: true },
          plannerDecision: { ...plannerDecisionJsonSchema, nullable: true },
          executionReport: { ...executionReportJsonSchema, nullable: true },
          reviewVerdict: { ...reviewVerdictJsonSchema, nullable: true },
          ciSummary: { ...ciStatusSummaryJsonSchema, nullable: true },
          patchStatus: {
            type: "string",
            enum: ["none", "plan_ready", "patch_ready", "patch_exported", "branch_ready", "promotion_ready", "waiting_approval", "approved_for_apply", "applied", "promoted", "rejected"],
          },
          approvalStatus: {
            type: "string",
            enum: ["not_requested", "pending_plan", "pending_patch", "approved", "rejected"],
          },
          promotionStatus: {
            type: "string",
            enum: ["not_ready", "patch_exported", "branch_ready", "promotion_ready", "promoted", "rejected"],
          },
          liveAcceptanceStatus: {
            type: "string",
            enum: ["not_run", "skipped", "passed", "failed", "blocked"],
          },
          livePassStatus: {
            type: "string",
            enum: ["not_run", "skipped", "passed", "failed", "blocked"],
          },
          workspaceStatus: {
            type: "string",
            enum: ["unknown", "clean", "active", "stale", "orphaned", "cleaned"],
          },
          exportArtifactPaths: { type: "array", items: { type: "string" } },
          handoffStatus: {
            type: "string",
            enum: ["not_ready", "exported", "handoff_ready", "branch_published", "handoff_failed"],
          },
          prDraftStatus: {
            type: "string",
            enum: ["not_ready", "metadata_ready", "payload_ready", "skipped", "failed"],
          },
          handoffArtifactPaths: { type: "array", items: { type: "string" } },
          artifactPruneResult: {
            type: "object",
            nullable: true,
            required: ["status", "retainedIterations", "deletedPaths", "skippedReasons", "summary", "prunedAt"],
            additionalProperties: false,
            properties: {
              status: { type: "string", enum: ["not_run", "pruned", "skipped", "failed"] },
              retainedIterations: { type: "array", items: { type: "number" } },
              deletedPaths: { type: "array", items: { type: "string" } },
              skippedReasons: { type: "array", items: { type: "string" } },
              summary: { type: "string" },
              prunedAt: { type: "string" },
            },
          },
          cleanupDecision: {
            type: "object",
            nullable: true,
            required: ["workspaceStatus", "deletedPaths", "retainedPaths", "orphanPaths", "stalePaths", "summary", "cleanedAt"],
            additionalProperties: false,
            properties: {
              workspaceStatus: { type: "string", enum: ["unknown", "clean", "active", "stale", "orphaned", "cleaned"] },
              deletedPaths: { type: "array", items: { type: "string" } },
              retainedPaths: { type: "array", items: { type: "string" } },
              orphanPaths: { type: "array", items: { type: "string" } },
              stalePaths: { type: "array", items: { type: "string" } },
              summary: { type: "string" },
              cleanedAt: { type: "string" },
            },
          },
          auditTrailPath: { type: "string", nullable: true },
          liveEvidencePath: { type: "string", nullable: true },
          githubHandoffResultPath: { type: "string", nullable: true },
          stateBefore: {
            type: "string",
            enum: [
              "draft",
              "planning",
              "waiting_approval",
              "executing",
              "awaiting_result",
              "validating",
              "ci_running",
              "needs_revision",
              "blocked",
              "completed",
              "stopped",
            ],
          },
          stateAfter: {
            type: "string",
            enum: [
              "draft",
              "planning",
              "waiting_approval",
              "executing",
              "awaiting_result",
              "validating",
              "ci_running",
              "needs_revision",
              "blocked",
              "completed",
              "stopped",
            ],
          },
          stopReason: { type: "string", nullable: true },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
        },
      },
    },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};
