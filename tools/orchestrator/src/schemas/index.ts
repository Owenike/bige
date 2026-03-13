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

export const nextIterationPlanSchema = z.object({
  iterationNumber: z.number().int().positive(),
  plannerDecision: plannerDecisionSchema,
  approvalRequired: z.boolean(),
  executorMode: z.enum(["mock", "local_repo"]),
});

export const reviewVerdictSchema = z.object({
  verdict: z.enum(["accept", "revise", "stop", "escalate"]),
  reasons: z.array(z.string()),
  violatedConstraints: z.array(z.string()),
  missingValidation: z.array(z.string()),
  suggestedPatchScope: z.array(z.string()),
  canAutoContinue: z.boolean(),
});

export const orchestratorStatusSchema = z.enum([
  "draft",
  "planning",
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
  executorMode: z.enum(["mock", "local_repo"]).default("mock"),
  executorCommand: z.array(z.string()).default([]),
});

export const orchestratorStateSchema = z.object({
  id: z.string(),
  status: orchestratorStatusSchema,
  iterationNumber: z.number().int().nonnegative(),
  consecutiveFailures: z.number().int().nonnegative(),
  pendingHumanApproval: z.boolean().default(false),
  task: orchestratorTaskSchema,
  plannerDecision: plannerDecisionSchema.nullable().default(null),
  nextIterationPlan: nextIterationPlanSchema.nullable().default(null),
  lastExecutionReport: executionReportSchema.nullable().default(null),
  lastReviewVerdict: reviewVerdictSchema.nullable().default(null),
  lastCIStatus: ciStatusSummarySchema.nullable().default(null),
  stopReason: z.string().nullable().default(null),
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
    "pendingHumanApproval",
    "task",
    "plannerDecision",
    "nextIterationPlan",
    "lastExecutionReport",
    "lastReviewVerdict",
    "lastCIStatus",
    "stopReason",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    status: {
      type: "string",
      enum: ["draft", "planning", "executing", "awaiting_result", "validating", "ci_running", "needs_revision", "blocked", "completed", "stopped"],
    },
    iterationNumber: { type: "number" },
    consecutiveFailures: { type: "number" },
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
        "executorCommand",
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
        executorMode: { type: "string", enum: ["mock", "local_repo"] },
        executorCommand: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    plannerDecision: { ...plannerDecisionJsonSchema, nullable: true },
    nextIterationPlan: {
      type: "object",
      nullable: true,
      required: ["iterationNumber", "plannerDecision", "approvalRequired", "executorMode"],
      additionalProperties: false,
      properties: {
        iterationNumber: { type: "number" },
        plannerDecision: plannerDecisionJsonSchema,
        approvalRequired: { type: "boolean" },
        executorMode: { type: "string", enum: ["mock", "local_repo"] },
      },
    },
    lastExecutionReport: { ...executionReportJsonSchema, nullable: true },
    lastReviewVerdict: { ...reviewVerdictJsonSchema, nullable: true },
    lastCIStatus: { ...ciStatusSummaryJsonSchema, nullable: true },
    stopReason: { type: "string", nullable: true },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};
