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

export type GptCodeStructuredReport = z.infer<typeof gptCodeStructuredReportSchema>;
export type GptCodeNormalizedReport = z.infer<typeof gptCodeNormalizedReportSchema>;
export type GptCodeEvidenceCrossCheck = z.infer<typeof gptCodeEvidenceCrossCheckSchema>;
