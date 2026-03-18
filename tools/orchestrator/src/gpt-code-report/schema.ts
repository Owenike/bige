import { z } from "zod";
import { ciStatusSummarySchema, executionReportSchema } from "../schemas";

export const gptCodeReportSuggestionLevelSchema = z.enum(["小", "中", "大"]);
export const gptCodeReportConfidenceSchema = z.enum(["high", "medium", "low"]);
export const gptCodeReportFieldStatusSchema = z.enum(["present", "missing", "partial"]);
export const gptCodeReportCiStatusSchema = z.enum([
  "success",
  "failure",
  "in_progress",
  "queued",
  "skipped",
  "not_run",
  "unknown",
]);
export const gptCodeReportValidationStatusSchema = z.enum(["passed", "failed", "skipped", "not_run", "unknown"]);

export const gptCodeReportFileEntrySchema = z.object({
  path: z.string(),
  rawLine: z.string(),
});

export const gptCodeReportValidationEntrySchema = z.object({
  command: z.string(),
  status: gptCodeReportValidationStatusSchema,
  rawLine: z.string(),
});

export const gptCodeReportCiRunEntrySchema = z.object({
  label: z.string(),
  runId: z.string().nullable().default(null),
  status: gptCodeReportCiStatusSchema,
  rawLine: z.string(),
});

export const gptCodeReportSectionsSchema = z.object({
  completedWhat: z.array(z.string()).default([]),
  whyThisWasDone: z.array(z.string()).default([]),
  howBehaviorWasKeptStable: z.array(z.string()).default([]),
  acceptanceRawLines: z.array(z.string()).default([]),
  commitPushRawLines: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
  remainingTodo: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  keySummary: z.array(z.string()).default([]),
});

export const gptCodeReportSectionStatesSchema = z.object({
  suggestionLevel: gptCodeReportFieldStatusSchema,
  judgmentReason: gptCodeReportFieldStatusSchema,
  modifiedFiles: gptCodeReportFieldStatusSchema,
  checkedButUnmodifiedFiles: gptCodeReportFieldStatusSchema,
  completedWhat: gptCodeReportFieldStatusSchema,
  whyThisWasDone: gptCodeReportFieldStatusSchema,
  howBehaviorWasKeptStable: gptCodeReportFieldStatusSchema,
  acceptance: gptCodeReportFieldStatusSchema,
  commitPush: gptCodeReportFieldStatusSchema,
  notes: gptCodeReportFieldStatusSchema,
  remainingTodo: gptCodeReportFieldStatusSchema,
  risks: gptCodeReportFieldStatusSchema,
  gitStatus: gptCodeReportFieldStatusSchema,
  currentTurnChanges: gptCodeReportFieldStatusSchema,
  unrelatedDirtyChanges: gptCodeReportFieldStatusSchema,
  ciRuns: gptCodeReportFieldStatusSchema,
  keySummary: gptCodeReportFieldStatusSchema,
});

export const gptCodeStructuredReportSchema = z.object({
  rawText: z.string(),
  suggestionLevel: gptCodeReportSuggestionLevelSchema.nullable().default(null),
  judgmentReason: z.string().nullable().default(null),
  modifiedFiles: z.array(gptCodeReportFileEntrySchema).default([]),
  checkedButUnmodifiedFiles: z.array(gptCodeReportFileEntrySchema).default([]),
  sections: gptCodeReportSectionsSchema,
  gitStatusIsClean: z.boolean().nullable().default(null),
  currentTurnChanges: z.array(gptCodeReportFileEntrySchema).default([]),
  unrelatedDirtyChanges: z.array(gptCodeReportFileEntrySchema).default([]),
  ciRuns: z.array(gptCodeReportCiRunEntrySchema).default([]),
  acceptanceResults: z.array(gptCodeReportValidationEntrySchema).default([]),
  parseWarnings: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  confidence: gptCodeReportConfidenceSchema,
  sectionStates: gptCodeReportSectionStatesSchema,
});

export const gptCodeValidationSummarySchema = z.object({
  reportedResults: z.array(gptCodeReportValidationEntrySchema).default([]),
  minimalChecksOnly: z.boolean(),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
});

export const gptCodeDirtyTreeSummarySchema = z.object({
  isClean: z.boolean().nullable().default(null),
  currentTurnFiles: z.array(z.string()).default([]),
  unrelatedFiles: z.array(z.string()).default([]),
  summary: z.string(),
});

export const gptCodeCommitPushSummarySchema = z.object({
  hasCommit: z.boolean().nullable().default(null),
  hasPush: z.boolean().nullable().default(null),
  commitIds: z.array(z.string()).default([]),
  rawLines: z.array(z.string()).default([]),
  summary: z.string(),
});

export const gptCodeCompletionSignalSchema = z.object({
  functionallyComplete: z.boolean(),
  processComplete: z.boolean(),
  shouldCloseSliceCandidate: z.boolean(),
  needsManualReview: z.boolean(),
  reasons: z.array(z.string()).default([]),
});

export const gptCodeNormalizedReportSchema = z.object({
  parsedReport: gptCodeStructuredReportSchema,
  executionReport: executionReportSchema,
  validationSummary: gptCodeValidationSummarySchema,
  ciSummary: ciStatusSummarySchema.nullable().default(null),
  dirtyTreeSummary: gptCodeDirtyTreeSummarySchema,
  commitPushSummary: gptCodeCommitPushSummarySchema,
  completionSignal: gptCodeCompletionSignalSchema,
  unresolvedRisks: z.array(z.string()).default([]),
  recommendedNextStepCandidate: z.string(),
  parseWarnings: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
});

export const gptCodeEvidenceMismatchSchema = z.object({
  field: z.enum(["changed_files", "ci_status", "git_dirty_tree", "validation_summary"]),
  reported: z.string(),
  actual: z.string(),
  summary: z.string(),
});

export const gptCodeEvidenceCrossCheckSchema = z.object({
  status: z.enum(["match", "mismatch", "needs_manual_review"]),
  mismatches: z.array(gptCodeEvidenceMismatchSchema).default([]),
  warnings: z.array(z.string()).default([]),
  needsManualReview: z.boolean(),
});

export const gptCodeReportOutputTargetSchema = z.object({
  artifactRoot: z.string(),
  parsedReportPath: z.string(),
  normalizedReportPath: z.string(),
  crossCheckPath: z.string(),
  nextInstructionPath: z.string(),
  outputPayloadPath: z.string(),
});

export const gptCodeReportOutputPayloadSchema = z.object({
  stateId: z.string(),
  generatedAt: z.string(),
  needsManualReview: z.boolean(),
  reviewVerdict: z.enum(["accept", "revise", "stop", "escalate"]),
  nextInstruction: z.string(),
  recommendedNextStep: z.string(),
  plannerObjective: z.string().nullable().default(null),
  outputTarget: gptCodeReportOutputTargetSchema,
});

export const gptCodeReportBridgeResultSchema = z.object({
  stateId: z.string(),
  status: z.enum(["accepted", "needs_manual_review"]),
  parsedReport: gptCodeStructuredReportSchema,
  normalizedReport: gptCodeNormalizedReportSchema,
  evidenceCrossCheck: gptCodeEvidenceCrossCheckSchema,
  outputTarget: gptCodeReportOutputTargetSchema,
  outputPayload: gptCodeReportOutputPayloadSchema,
  generatedAt: z.string(),
});

export const gptCodeTransportSourceSchema = z.enum([
  "stdin",
  "cli",
  "repo_drop",
  "manual",
  "test",
  "github_issue_comment",
  "github_pull_request_review_comment",
  "github_issue_body",
  "github_pull_request_body",
]);

export const gptCodeTransportEntryResultSchema = z.object({
  stateId: z.string(),
  status: z.enum(["queued", "failed"]),
  transportSource: gptCodeTransportSourceSchema,
  intakeArtifactPath: z.string(),
  generatedAt: z.string(),
});

export const gptCodeDispatchEnvelopeSchema = z.object({
  stateId: z.string(),
  dispatchedAt: z.string(),
  dispatchTarget: z.string(),
  consumer: z.string(),
  nextInstruction: z.string(),
  outputPayloadPath: z.string(),
  nextInstructionPath: z.string(),
  reviewVerdict: z.enum(["accept", "revise", "stop", "escalate"]),
  needsManualReview: z.boolean(),
});

export const gptCodeDispatchGateDecisionSchema = z.object({
  status: z.enum(["ready", "manual_required", "not_needed"]),
  reasons: z.array(z.string()).default([]),
  recommendedNextStep: z.string(),
});

export const gptCodeTransportDispatchResultSchema = z.object({
  stateId: z.string(),
  intakeStatus: z.enum(["accepted", "manual_required", "failed"]),
  bridgeStatus: z.enum(["accepted", "needs_manual_review", "failed"]),
  dispatchStatus: z.enum(["dispatched", "manual_required", "failed", "not_needed"]),
  dispatchTarget: z.string().nullable().default(null),
  dispatchArtifactPath: z.string().nullable().default(null),
  outputPayloadPath: z.string().nullable().default(null),
  nextInstructionPath: z.string().nullable().default(null),
  generatedAt: z.string(),
});

export const gptCodeTransportWatcherSummarySchema = z.object({
  processedStateIds: z.array(z.string()).default([]),
  dispatchedStateIds: z.array(z.string()).default([]),
  manualReviewStateIds: z.array(z.string()).default([]),
  failedStateIds: z.array(z.string()).default([]),
  generatedAt: z.string(),
});

export const gptCodeExternalSourceMetadataSchema = z.object({
  sourceType: z.enum([
    "github_issue_comment",
    "github_pull_request_review_comment",
    "github_issue_body",
    "github_pull_request_body",
  ]),
  sourceLaneClassification: z.enum([
    "github_issue_comment_lane",
    "github_pull_request_review_comment_lane",
    "github_issue_body_lane",
    "github_pull_request_body_lane",
  ]),
  sourceId: z.string(),
  sourceCorrelationId: z.string(),
  repository: z.string(),
  issueNumber: z.number().int().positive().nullable().default(null),
  prNumber: z.number().int().positive().nullable().default(null),
  commentId: z.number().int().positive().nullable().default(null),
  payloadPath: z.string().nullable().default(null),
  headersPath: z.string().nullable().default(null),
  receivedAt: z.string(),
});

export const gptCodeExternalTargetDispatchSchema = z.object({
  stateId: z.string(),
  targetType: z.enum(["github_issue_comment"]),
  targetLaneClassification: z.enum([
    "github_issue_thread_comment_lane",
    "github_pull_request_thread_comment_lane",
    "github_live_smoke_comment_lane",
    "github_status_report_comment_lane",
    "github_source_thread_fallback_lane",
    "repo_local_outbox_lane",
  ]),
  targetDestination: z.string(),
  routingDecision: z.enum([
    "live_smoke_target",
    "status_report_target",
    "state_thread_target",
    "source_thread_fallback",
    "manual_required",
  ]),
  fallbackDecision: z.enum([
    "not_needed",
    "live_smoke_target_fallback",
    "status_report_target_fallback",
    "source_thread_fallback",
    "manual_required",
  ]),
  attemptCount: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(2),
  outcome: z.enum(["success", "manual_required", "failed", "retryable", "exhausted"]),
  retryEligible: z.boolean().default(false),
  failureClass: z
    .enum(["auth", "routing", "target_invalid", "rate_limited", "network", "transient", "unknown"])
    .nullable()
    .default(null),
  correlationId: z.string(),
  externalReferenceId: z.string().nullable().default(null),
  externalUrl: z.string().nullable().default(null),
  routeTrace: z.array(z.string()).default([]),
  deliverySummary: z.string().nullable().default(null),
  manualReviewReason: z.string().nullable().default(null),
  recommendedNextStep: z.string().nullable().default(null),
  exhausted: z.boolean().default(false),
  dispatchArtifactPath: z.string().nullable().default(null),
  dispatchedAt: z.string(),
});

export const gptCodeExternalAutomationResultSchema = z.object({
  stateId: z.string(),
  source: gptCodeExternalSourceMetadataSchema,
  sourceStatus: z.enum(["received", "linked", "manual_required", "failed"]),
  automaticTriggerStatus: z.enum(["triggered", "manual_required", "failed"]),
  transportDispatchStatus: z.enum(["dispatched", "manual_required", "failed", "not_needed"]),
  targetDispatch: gptCodeExternalTargetDispatchSchema.nullable().default(null),
  outcome: z.enum(["success", "manual_required", "failed", "retryable", "exhausted"]),
  generatedAt: z.string(),
});

export type GptCodeStructuredReport = z.infer<typeof gptCodeStructuredReportSchema>;
export type GptCodeNormalizedReport = z.infer<typeof gptCodeNormalizedReportSchema>;
export type GptCodeEvidenceCrossCheck = z.infer<typeof gptCodeEvidenceCrossCheckSchema>;
export type GptCodeReportOutputTarget = z.infer<typeof gptCodeReportOutputTargetSchema>;
export type GptCodeReportOutputPayload = z.infer<typeof gptCodeReportOutputPayloadSchema>;
export type GptCodeReportBridgeResult = z.infer<typeof gptCodeReportBridgeResultSchema>;
export type GptCodeTransportSource = z.infer<typeof gptCodeTransportSourceSchema>;
export type GptCodeTransportEntryResult = z.infer<typeof gptCodeTransportEntryResultSchema>;
export type GptCodeDispatchEnvelope = z.infer<typeof gptCodeDispatchEnvelopeSchema>;
export type GptCodeDispatchGateDecision = z.infer<typeof gptCodeDispatchGateDecisionSchema>;
export type GptCodeTransportDispatchResult = z.infer<typeof gptCodeTransportDispatchResultSchema>;
export type GptCodeTransportWatcherSummary = z.infer<typeof gptCodeTransportWatcherSummarySchema>;
export type GptCodeExternalSourceMetadata = z.infer<typeof gptCodeExternalSourceMetadataSchema>;
export type GptCodeExternalTargetDispatch = z.infer<typeof gptCodeExternalTargetDispatchSchema>;
export type GptCodeExternalAutomationResult = z.infer<typeof gptCodeExternalAutomationResultSchema>;
