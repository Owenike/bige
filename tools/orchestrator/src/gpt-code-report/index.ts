import path from "node:path";
import {
  ciStatusSummarySchema,
  executionReportSchema,
  type CIStatusSummary,
  type ExecutionReport,
  type PlannerDecision,
  type ReviewVerdict,
} from "../schemas";
import {
  gptCodeEvidenceCrossCheckSchema,
  gptCodeNormalizedReportSchema,
  gptCodeStructuredReportSchema,
  type GptCodeEvidenceCrossCheck,
  type GptCodeNormalizedReport,
  type GptCodeStructuredReport,
} from "./schema";

const SECTION_LABELS = {
  modifiedFiles: "本輪實際修改到的檔案路徑",
  checkedButUnmodifiedFiles: "本輪僅檢查未修改的檔案路徑",
  completedWhat: "本輪完成了什麼",
  whyThisWasDone: "為什麼這樣做",
  howBehaviorWasKeptStable: "如何確保既有邏輯不變",
  acceptance: "驗收結果",
  commitPush: "已 commit / push",
  notes: "補充",
  remainingTodo: "剩餘待辦",
  risks: "風險提醒",
  gitStatus: "git status --short 是否乾淨",
  dirtySplit: "若不乾淨，請分開列出",
  ciRuns: "CI run 狀態",
  keySummary: "關鍵摘要",
} as const;

type SectionKey = keyof typeof SECTION_LABELS;

const SECTION_NAMES = new Map<string, SectionKey>(
  Object.entries(SECTION_LABELS).map(([key, value]) => [normalizeHeading(value), key as SectionKey]),
);

function normalizeHeading(value: string) {
  return value.replace(/^\*+|\*+$/g, "").replace(/[：:]+$/g, "").trim();
}

function normalizeLines(text: string) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function isBulletLine(line: string) {
  return /^-\s+/.test(line.trim());
}

function stripBullet(line: string) {
  return line.trim().replace(/^-\s+/, "").trim();
}

function isEmptyOrNone(value: string) {
  return /^(無|none|n\/a|沒有)$/i.test(value.trim());
}

function parseFileEntries(lines: string[]) {
  const entries: { path: string; rawLine: string }[] = [];
  for (const line of lines) {
    const trimmed = stripBullet(line);
    if (!trimmed || isEmptyOrNone(trimmed)) continue;
    const markdownMatches = [...trimmed.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];
    if (markdownMatches.length > 0) {
      for (const match of markdownMatches) {
        const path = match[1]?.trim();
        if (path) {
          entries.push({ path, rawLine: line.trim() });
        }
      }
      continue;
    }

    if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("/")) {
      entries.push({ path: trimmed, rawLine: line.trim() });
    }
  }
  return dedupeFileEntries(entries);
}

function dedupeFileEntries(entries: { path: string; rawLine: string }[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.path)) return false;
    seen.add(entry.path);
    return true;
  });
}

function inferValidationStatus(line: string, context: "passed" | "failed" | "skipped" | "not_run" | "unknown") {
  if (/failed|失敗/i.test(line)) return "failed" as const;
  if (/passed|通過|全綠|仍綠|success/i.test(line)) return "passed" as const;
  if (/skipped|略過/i.test(line)) return "skipped" as const;
  if (/未執行|not run/i.test(line)) return "not_run" as const;
  return context;
}

function parseAcceptanceResults(lines: string[]) {
  const results: { command: string; status: "passed" | "failed" | "skipped" | "not_run" | "unknown"; rawLine: string }[] = [];
  let context: "passed" | "failed" | "skipped" | "not_run" | "unknown" = "unknown";

  for (const rawLine of lines) {
    const line = stripBullet(rawLine);
    if (!line) continue;
    if (/通過|passed|success/i.test(line) && !line.includes("npm run") && !line.includes("powershell ")) {
      context = "passed";
      continue;
    }
    if (/失敗|failed/i.test(line) && !line.includes("npm run") && !line.includes("powershell ")) {
      context = "failed";
      continue;
    }

    const commandMatch = line.match(/`([^`]+)`/);
    const command =
      commandMatch?.[1] ??
      (/^(npm run|powershell\s+-ExecutionPolicy|node\s+)/i.test(line) ? line : null);
    if (!command) continue;

    results.push({
      command: command.trim(),
      status: inferValidationStatus(line, context),
      rawLine: rawLine.trim(),
    });
  }

  return results;
}

function parseCiStatus(value: string) {
  if (/success/i.test(value)) return "success" as const;
  if (/failure|failed/i.test(value)) return "failure" as const;
  if (/queued/i.test(value)) return "queued" as const;
  if (/in[_ ]?progress/i.test(value)) return "in_progress" as const;
  if (/skipped/i.test(value)) return "skipped" as const;
  if (/not[_ ]?run/i.test(value)) return "not_run" as const;
  return "unknown" as const;
}

function parseCiRuns(lines: string[]) {
  return lines.flatMap((rawLine) => {
    const line = stripBullet(rawLine);
    const runId = line.match(/\b(\d{6,})\b/)?.[1] ?? null;
    const quotedStatus = line.match(/[`'"]?(success|failure|failed|in_progress|queued|skipped|not_run)[`'"]?/i)?.[1] ?? "";
    const status = parseCiStatus(quotedStatus || line);
    if (!runId && status === "unknown") return [];
    return [
      {
        label: line.replace(/[`'"]?(success|failure|failed|in_progress|queued|skipped|not_run)[`'"]?/gi, "").trim(),
        runId,
        status,
        rawLine: rawLine.trim(),
      },
    ];
  });
}

function parseDirtySplit(lines: string[]) {
  const currentTurn: string[] = [];
  const unrelated: string[] = [];
  let bucket: "currentTurn" | "unrelated" | null = null;

  for (const rawLine of lines) {
    const line = stripBullet(rawLine);
    if (!line) continue;
    if (/^本輪造成的變更$/.test(line)) {
      bucket = "currentTurn";
      continue;
    }
    if (/^與本輪無關的既有變更$/.test(line)) {
      bucket = "unrelated";
      continue;
    }
    if (bucket === "currentTurn") {
      currentTurn.push(rawLine);
    } else if (bucket === "unrelated") {
      unrelated.push(rawLine);
    }
  }

  return {
    currentTurn: parseFileEntries(currentTurn),
    unrelated: parseFileEntries(unrelated),
  };
}

function parseSectionMap(text: string) {
  const sectionLines: Record<SectionKey, string[]> = {
    modifiedFiles: [],
    checkedButUnmodifiedFiles: [],
    completedWhat: [],
    whyThisWasDone: [],
    howBehaviorWasKeptStable: [],
    acceptance: [],
    commitPush: [],
    notes: [],
    remainingTodo: [],
    risks: [],
    gitStatus: [],
    dirtySplit: [],
    ciRuns: [],
    keySummary: [],
  };
  const preamble: string[] = [];
  let currentSection: SectionKey | null = null;

  for (const rawLine of normalizeLines(text)) {
    const trimmed = rawLine.trim();
    const sectionName = SECTION_NAMES.get(normalizeHeading(trimmed));
    if (sectionName) {
      currentSection = sectionName;
      continue;
    }

    if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
      currentSection = null;
      continue;
    }

    if (currentSection) {
      sectionLines[currentSection].push(rawLine);
    } else {
      preamble.push(rawLine);
    }
  }

  return { preamble, sectionLines };
}

function parseSuggestionLevel(preamble: string[]) {
  const line = preamble.find((entry) => entry.includes("建議級別"));
  const match = line?.match(/建議級別[：:]\s*(小|中|大)/);
  return match?.[1] ?? null;
}

function parseJudgmentReason(preamble: string[]) {
  const headerIndex = preamble.findIndex((line) => normalizeHeading(line) === "判斷理由");
  if (headerIndex === -1) return null;
  const collected: string[] = [];
  for (let index = headerIndex + 1; index < preamble.length; index += 1) {
    const line = preamble[index].trim();
    if (!line) {
      if (collected.length > 0) break;
      continue;
    }
    if (/^[^\s].+[：:]$/.test(line)) break;
    collected.push(line);
  }
  return collected.length > 0 ? collected.join(" ").trim() : null;
}

function determineFieldStatus<T>(value: T[] | string | boolean | null | undefined) {
  if (Array.isArray(value)) return value.length > 0 ? "present" : "missing";
  if (typeof value === "string") return value.trim() ? "present" : "missing";
  if (typeof value === "boolean") return "present";
  return "missing";
}

function buildConfidence(missingFields: string[], parseWarnings: string[]) {
  if (missingFields.length === 0 && parseWarnings.length === 0) return "high" as const;
  if (missingFields.length <= 3 && parseWarnings.length <= 3) return "medium" as const;
  return "low" as const;
}

function buildCiSummary(parsed: GptCodeStructuredReport): CIStatusSummary | null {
  const latestRun = [...parsed.ciRuns].reverse().find((entry) => entry.runId || entry.status !== "unknown");
  if (!latestRun) return null;
  const status =
    latestRun.status === "queued"
      ? "in_progress"
      : latestRun.status === "unknown"
        ? "not_run"
        : latestRun.status;

  return ciStatusSummarySchema.parse({
    provider: "none",
    workflowName: latestRun.label || "reported_ci",
    runId: latestRun.runId,
    status,
    jobs: [],
    summary: latestRun.rawLine,
  });
}

function summarizeCommitPush(lines: string[]) {
  const text = lines.join(" ");
  const explicitNoCommit = /無 commit|未 commit/i.test(text);
  const explicitNoPush = /無 push|未 push/i.test(text);
  const commitIds = [...text.matchAll(/\b[0-9a-f]{7,40}\b/gi)].map((match) => match[0]);

  const hasCommit = explicitNoCommit ? false : commitIds.length > 0 || /commit[:：]|已 commit/i.test(text) ? true : null;
  const hasPush = explicitNoPush ? false : /已 push|push 到|push:|pushed/i.test(text) ? true : null;

  return {
    hasCommit,
    hasPush,
    commitIds: [...new Set(commitIds)],
    rawLines: lines.map((line) => line.trim()).filter(Boolean),
    summary:
      hasCommit === false || hasPush === false
        ? "Report indicates commit/push is incomplete."
        : hasCommit && hasPush
          ? "Report indicates commit and push completed."
          : "Commit/push state is only partially available from the report.",
  };
}

function summarizeValidation(parsed: GptCodeStructuredReport) {
  const statuses = parsed.acceptanceResults.map((entry) => entry.status);
  return {
    reportedResults: parsed.acceptanceResults,
    minimalChecksOnly: parsed.sections.acceptanceRawLines.some((line) => /最小必要檢查/i.test(line)),
    passedCount: statuses.filter((status) => status === "passed").length,
    failedCount: statuses.filter((status) => status === "failed").length,
    skippedCount: statuses.filter((status) => status === "skipped" || status === "not_run").length,
    unknownCount: statuses.filter((status) => status === "unknown").length,
  };
}

function deriveValidationResults(parsed: GptCodeStructuredReport) {
  return parsed.acceptanceResults.map((entry) => ({
    command: entry.command,
    status:
      entry.status === "unknown"
        ? "not_run"
        : entry.status === "passed" || entry.status === "failed" || entry.status === "skipped" || entry.status === "not_run"
          ? entry.status
          : "not_run",
    output: entry.rawLine,
  }));
}

function deriveExecutionReport(parsed: GptCodeStructuredReport, ciSummary: CIStatusSummary | null): ExecutionReport {
  const validationResults = deriveValidationResults(parsed);
  const remainingTodo = parsed.sections.remainingTodo.filter((item) => !isEmptyOrNone(item));
  const risks = parsed.sections.risks.filter((item) => !isEmptyOrNone(item));
  const shouldCloseSlice =
    remainingTodo.length === 0 &&
    validationResults.every((entry) => entry.status !== "failed") &&
    (!ciSummary || ciSummary.status === "success" || ciSummary.status === "not_run");

  return executionReportSchema.parse({
    iterationNumber: 1,
    changedFiles: parsed.modifiedFiles.map((entry) => entry.path),
    checkedButUnmodifiedFiles: parsed.checkedButUnmodifiedFiles.map((entry) => entry.path),
    summaryOfChanges: parsed.sections.completedWhat.filter((line) => !isEmptyOrNone(line)),
    whyThisWasDone: parsed.sections.whyThisWasDone.filter((line) => !isEmptyOrNone(line)),
    howBehaviorWasKeptStable: parsed.sections.howBehaviorWasKeptStable.filter((line) => !isEmptyOrNone(line)),
    localValidation: validationResults,
    ciValidation: ciSummary,
    blockers: remainingTodo,
    risks,
    recommendedNextStep: deriveRecommendedNextStep({
      remainingTodo,
      risks,
      ciSummary,
      gitStatusIsClean: parsed.gitStatusIsClean,
      currentTurnChanges: parsed.currentTurnChanges.map((entry) => entry.path),
    }),
    shouldCloseSlice,
    artifacts: [],
  });
}

function deriveRecommendedNextStep(params: {
  remainingTodo: string[];
  risks: string[];
  ciSummary: CIStatusSummary | null;
  gitStatusIsClean: boolean | null;
  currentTurnChanges: string[];
}) {
  if (params.remainingTodo.length > 0) return params.remainingTodo[0];
  if (params.ciSummary && params.ciSummary.status !== "success" && params.ciSummary.status !== "not_run") {
    return "Confirm the latest CI run reaches success before closure.";
  }
  if (params.gitStatusIsClean === false && params.currentTurnChanges.length > 0) {
    return "Separate current-turn changes from unrelated dirty tree before closure.";
  }
  if (params.risks.length > 0) return params.risks[0];
  return "Close the slice.";
}

function buildDirtyTreeSummary(parsed: GptCodeStructuredReport) {
  const currentTurnFiles = parsed.currentTurnChanges.map((entry) => entry.path);
  const unrelatedFiles = parsed.unrelatedDirtyChanges.map((entry) => entry.path);
  const summary =
    parsed.gitStatusIsClean === true
      ? "Report says git status is clean."
      : parsed.gitStatusIsClean === false
        ? `Report says git status is dirty with ${currentTurnFiles.length} current-turn and ${unrelatedFiles.length} unrelated entries.`
        : "Report does not clearly say whether git status is clean.";

  return {
    isClean: parsed.gitStatusIsClean,
    currentTurnFiles,
    unrelatedFiles,
    summary,
  };
}

function buildCompletionSignal(params: {
  parsed: GptCodeStructuredReport;
  validationSummary: ReturnType<typeof summarizeValidation>;
  ciSummary: CIStatusSummary | null;
  commitPushSummary: ReturnType<typeof summarizeCommitPush>;
  dirtyTreeSummary: ReturnType<typeof buildDirtyTreeSummary>;
}) {
  const functionallyComplete =
    params.parsed.sections.completedWhat.length > 0 &&
    params.validationSummary.failedCount === 0 &&
    params.parsed.sections.remainingTodo.length === 0;
  const processComplete =
    functionallyComplete &&
    (!!params.ciSummary ? params.ciSummary.status === "success" : true) &&
    params.commitPushSummary.hasPush !== false &&
    params.dirtyTreeSummary.currentTurnFiles.length === 0;

  const reasons: string[] = [];
  if (!functionallyComplete) reasons.push("Report still shows unresolved completion signals.");
  if (params.ciSummary && params.ciSummary.status !== "success" && params.ciSummary.status !== "not_run") {
    reasons.push("Latest CI run is not green.");
  }
  if (params.commitPushSummary.hasPush === false) reasons.push("Push is not completed.");
  if (params.dirtyTreeSummary.currentTurnFiles.length > 0) reasons.push("Current-turn dirty files remain in git status.");

  return {
    functionallyComplete,
    processComplete,
    shouldCloseSliceCandidate: processComplete && params.parsed.sections.risks.length === 0,
    needsManualReview: params.parsed.missingFields.length > 0 || params.parsed.parseWarnings.length > 0,
    reasons,
  };
}

export function parseGptCodeChineseReport(text: string): GptCodeStructuredReport {
  const { preamble, sectionLines } = parseSectionMap(text);
  const suggestionLevel = parseSuggestionLevel(preamble);
  const judgmentReason = parseJudgmentReason(preamble);
  const modifiedFiles = parseFileEntries(sectionLines.modifiedFiles);
  const checkedButUnmodifiedFiles = parseFileEntries(sectionLines.checkedButUnmodifiedFiles);
  const acceptanceResults = parseAcceptanceResults(sectionLines.acceptance);
  const ciRuns = parseCiRuns(sectionLines.ciRuns);
  const dirtySplit = parseDirtySplit(sectionLines.dirtySplit);

  const gitStatusLine = sectionLines.gitStatus.map((line) => stripBullet(line)).find(Boolean) ?? "";
  const gitStatusIsClean =
    gitStatusLine === "是" ? true : gitStatusLine === "否" ? false : null;

  const missingFields: string[] = [];
  if (!suggestionLevel) missingFields.push("建議級別");
  if (!judgmentReason) missingFields.push("判斷理由");
  if (modifiedFiles.length === 0) missingFields.push(SECTION_LABELS.modifiedFiles);
  if (sectionLines.acceptance.length === 0) missingFields.push(SECTION_LABELS.acceptance);
  if (ciRuns.length === 0) missingFields.push(SECTION_LABELS.ciRuns);

  const parseWarnings: string[] = [];
  if (sectionLines.dirtySplit.length > 0 && dirtySplit.currentTurn.length === 0 && dirtySplit.unrelated.length === 0) {
    parseWarnings.push("Dirty tree split section exists but no file paths were parsed.");
  }
  if (sectionLines.acceptance.length > 0 && acceptanceResults.length === 0) {
    parseWarnings.push("Acceptance section exists but no validation commands were parsed.");
  }
  if (sectionLines.ciRuns.length > 0 && ciRuns.length === 0) {
    parseWarnings.push("CI run section exists but no run ids or statuses were parsed.");
  }

  const report = gptCodeStructuredReportSchema.parse({
    rawText: text,
    suggestionLevel,
    judgmentReason,
    modifiedFiles,
    checkedButUnmodifiedFiles,
    sections: {
      completedWhat: sectionLines.completedWhat.map(stripBullet).filter(Boolean),
      whyThisWasDone: sectionLines.whyThisWasDone.map(stripBullet).filter(Boolean),
      howBehaviorWasKeptStable: sectionLines.howBehaviorWasKeptStable.map(stripBullet).filter(Boolean),
      acceptanceRawLines: sectionLines.acceptance.map((line) => line.trim()).filter(Boolean),
      commitPushRawLines: sectionLines.commitPush.map((line) => line.trim()).filter(Boolean),
      notes: sectionLines.notes.map(stripBullet).filter(Boolean),
      remainingTodo: sectionLines.remainingTodo.map(stripBullet).filter(Boolean),
      risks: sectionLines.risks.map(stripBullet).filter(Boolean),
      keySummary: sectionLines.keySummary.map(stripBullet).filter(Boolean),
    },
    gitStatusIsClean,
    currentTurnChanges: dirtySplit.currentTurn,
    unrelatedDirtyChanges: dirtySplit.unrelated,
    ciRuns,
    acceptanceResults,
    parseWarnings,
    missingFields,
    confidence: buildConfidence(missingFields, parseWarnings),
    sectionStates: {
      suggestionLevel: determineFieldStatus(suggestionLevel),
      judgmentReason: determineFieldStatus(judgmentReason),
      modifiedFiles: determineFieldStatus(modifiedFiles),
      checkedButUnmodifiedFiles: determineFieldStatus(checkedButUnmodifiedFiles),
      completedWhat: determineFieldStatus(sectionLines.completedWhat),
      whyThisWasDone: determineFieldStatus(sectionLines.whyThisWasDone),
      howBehaviorWasKeptStable: determineFieldStatus(sectionLines.howBehaviorWasKeptStable),
      acceptance: determineFieldStatus(sectionLines.acceptance),
      commitPush: determineFieldStatus(sectionLines.commitPush),
      notes: determineFieldStatus(sectionLines.notes),
      remainingTodo: determineFieldStatus(sectionLines.remainingTodo),
      risks: determineFieldStatus(sectionLines.risks),
      gitStatus: determineFieldStatus(gitStatusIsClean),
      currentTurnChanges: determineFieldStatus(dirtySplit.currentTurn),
      unrelatedDirtyChanges: determineFieldStatus(dirtySplit.unrelated),
      ciRuns: determineFieldStatus(ciRuns),
      keySummary: determineFieldStatus(sectionLines.keySummary),
    },
  });

  return report;
}

export function normalizeGptCodeChineseReport(parsed: GptCodeStructuredReport): GptCodeNormalizedReport {
  const ciSummary = buildCiSummary(parsed);
  const validationSummary = summarizeValidation(parsed);
  const dirtyTreeSummary = buildDirtyTreeSummary(parsed);
  const commitPushSummary = summarizeCommitPush(parsed.sections.commitPushRawLines);
  const completionSignal = buildCompletionSignal({
    parsed,
    validationSummary,
    ciSummary,
    commitPushSummary,
    dirtyTreeSummary,
  });
  const executionReport = deriveExecutionReport(parsed, ciSummary);

  return gptCodeNormalizedReportSchema.parse({
    parsedReport: parsed,
    executionReport,
    validationSummary,
    ciSummary,
    dirtyTreeSummary,
    commitPushSummary,
    completionSignal,
    unresolvedRisks: [
      ...executionReport.risks,
      ...completionSignal.reasons,
      ...parsed.parseWarnings,
      ...parsed.missingFields.map((field) => `Missing field: ${field}`),
    ],
    recommendedNextStepCandidate: executionReport.recommendedNextStep,
    parseWarnings: parsed.parseWarnings,
    missingFields: parsed.missingFields,
  });
}

function parseGitStatusShortPaths(gitStatusShort: string) {
  return gitStatusShort
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z? ]+/, "").trim())
    .filter(Boolean);
}

function normalizeComparablePath(filePath: string) {
  const trimmed = filePath.trim().replace(/\\/g, "/").replace(/^\/([A-Za-z]:\/)/, "$1");
  const normalizedCwd = path.normalize(process.cwd()).replace(/\\/g, "/").replace(/^\/([A-Za-z]:\/)/, "$1");
  if (trimmed.toLowerCase().startsWith(`${normalizedCwd.toLowerCase()}/`)) {
    return trimmed.slice(normalizedCwd.length + 1);
  }
  return trimmed;
}

export function crossCheckGptCodeChineseReport(params: {
  normalizedReport: GptCodeNormalizedReport;
  actualCI?: CIStatusSummary | null;
  actualGitStatusShort?: string | null;
  actualValidationSummary?: ExecutionReport["localValidation"] | null;
}): GptCodeEvidenceCrossCheck {
  const mismatches: GptCodeEvidenceCrossCheck["mismatches"] = [];
  const warnings: string[] = [];
  const normalizedChanged = params.normalizedReport.executionReport.changedFiles;
  const parsedChanged = params.normalizedReport.parsedReport.modifiedFiles.map((entry) => entry.path);

  if (JSON.stringify(parsedChanged) !== JSON.stringify(normalizedChanged)) {
    mismatches.push({
      field: "changed_files",
      reported: parsedChanged.join(", "),
      actual: normalizedChanged.join(", "),
      summary: "Parsed file list does not match normalized changedFiles.",
    });
  }

  if (params.actualCI) {
    const reportedCi = params.normalizedReport.ciSummary;
    if (!reportedCi) {
      warnings.push("Actual CI summary is available, but the report did not produce a normalized CI summary.");
    } else if (reportedCi.status !== params.actualCI.status || reportedCi.runId !== params.actualCI.runId) {
      mismatches.push({
        field: "ci_status",
        reported: `${reportedCi.runId ?? "none"}:${reportedCi.status}`,
        actual: `${params.actualCI.runId ?? "none"}:${params.actualCI.status}`,
        summary: "Reported CI status does not match the actual CI summary.",
      });
    }
  }

  if (params.actualGitStatusShort != null) {
    const actualPaths = parseGitStatusShortPaths(params.actualGitStatusShort).map(normalizeComparablePath);
    const reportedPaths = [
      ...params.normalizedReport.dirtyTreeSummary.currentTurnFiles,
      ...params.normalizedReport.dirtyTreeSummary.unrelatedFiles,
    ].map(normalizeComparablePath);
    if (JSON.stringify([...new Set(reportedPaths)].sort()) !== JSON.stringify([...new Set(actualPaths)].sort())) {
      mismatches.push({
        field: "git_dirty_tree",
        reported: [...new Set(reportedPaths)].sort().join(", "),
        actual: [...new Set(actualPaths)].sort().join(", "),
        summary: "Reported dirty tree does not match git status --short.",
      });
    }
  }

  if (params.actualValidationSummary) {
    const reported = params.normalizedReport.executionReport.localValidation.map((entry) => `${entry.command}:${entry.status}`);
    const actual = params.actualValidationSummary.map((entry) => `${entry.command}:${entry.status}`);
    if (JSON.stringify(reported) !== JSON.stringify(actual)) {
      mismatches.push({
        field: "validation_summary",
        reported: reported.join(", "),
        actual: actual.join(", "),
        summary: "Reported validation summary does not match the structured validation results.",
      });
    }
  }

  return gptCodeEvidenceCrossCheckSchema.parse({
    status: mismatches.length > 0 ? "mismatch" : warnings.length > 0 ? "needs_manual_review" : "match",
    mismatches,
    warnings,
    needsManualReview: mismatches.length > 0 || warnings.length > 0,
  });
}

function translateSliceLevel(sliceLevel: PlannerDecision["sliceLevel"] | undefined) {
  if (sliceLevel === "small") return "小";
  if (sliceLevel === "large") return "大";
  return "中";
}

export function renderNextInstructionFromNormalizedReport(params: {
  normalizedReport: GptCodeNormalizedReport;
  reviewVerdict: ReviewVerdict;
  plannerDecision?: PlannerDecision | null;
  evidenceCrossCheck?: GptCodeEvidenceCrossCheck | null;
}) {
  const suggestedLevel =
    params.normalizedReport.completionSignal.processComplete || params.reviewVerdict.verdict === "revise"
      ? "小"
      : translateSliceLevel(params.plannerDecision?.sliceLevel);
  const rationale = [
    ...params.reviewVerdict.reasons,
    ...params.normalizedReport.unresolvedRisks.slice(0, 3),
    ...(params.evidenceCrossCheck?.mismatches.map((entry) => entry.summary) ?? []),
  ].filter(Boolean);
  const objectiveLines = [
    params.normalizedReport.recommendedNextStepCandidate,
    ...params.reviewVerdict.suggestedPatchScope.slice(0, 3).map((item) => `收斂範圍：${item}`),
    ...(params.evidenceCrossCheck?.needsManualReview ? ["先核對回報與實際證據是否一致。"] : []),
  ];
  const acceptanceCommands =
    params.plannerDecision?.acceptanceCommands.length ? params.plannerDecision.acceptanceCommands : ["manual completion required"];
  const manualCompletionRequired =
    params.normalizedReport.missingFields.length > 0 || params.evidenceCrossCheck?.needsManualReview;

  return [
    `建議級別：${suggestedLevel}`,
    "",
    "判斷理由",
    ...rationale.map((line) => `- ${line}`),
    "",
    "這輪是否能共用同一組驗收",
    `- ${params.plannerDecision ? "可以" : "部分可以；缺少 planner 決策時需人工補 acceptance 指令。"}`,
    "",
    "先回報本輪收尾後的 CI run 狀態",
    "- 請先回報目前最新 CI run 狀態",
    "",
    "本輪實際要推進的方向",
    `- ${params.normalizedReport.recommendedNextStepCandidate}`,
    "",
    "本輪目標",
    ...objectiveLines.map((line, index) => `${index + 1}. ${line}`),
    "",
    "交付方式",
    "- 請依照既有專案回報格式交付，不要貼完整檔案內容。",
    "- 請明確區分 parser 直接解析、normalize 派生、reviewer 推導。",
    "",
    "回覆格式要求",
    "- 路徑請用完整絕對路徑。",
    "- 若仍需人工補欄位，請明講 manual completion required。",
    "",
    "本輪驗收指令",
    ...acceptanceCommands.map((command) => `- ${command}`),
    "",
    "補充要求",
    `- ${manualCompletionRequired ? "目前仍需要人工複製貼上與人工補欄位確認。" : "這輪可沿用既有自動 reviewer / planner 結構。"}`,
    `- ${params.evidenceCrossCheck?.needsManualReview ? "evidence cross-check 有 mismatch 或 warning，需人工覆核。" : "若無額外 mismatch，可直接沿用 normalize 結果。"}`,
  ].join("\n");
}
