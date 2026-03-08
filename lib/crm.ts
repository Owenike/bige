import type { AppRole, ProfileContext } from "./auth-context";

export type CrmLeadStatus =
  | "new"
  | "contacted"
  | "trial_booked"
  | "trial_completed"
  | "won"
  | "lost"
  | "dormant";

export type CrmLeadTemperature = "hot" | "warm" | "cold";
export type CrmLeadSource = "walk-in" | "referral" | "ad" | "instagram" | "line" | "google" | "other";
export type CrmFollowupType = "call" | "message" | "visit" | "consult" | "trial" | "other";
export type CrmTrialStatus = "scheduled" | "attended" | "no_show" | "canceled" | "rescheduled";
export type CrmTrialResult = "interested" | "follow_up_needed" | "won" | "lost";

const LEAD_STATUS_SET = new Set<CrmLeadStatus>([
  "new",
  "contacted",
  "trial_booked",
  "trial_completed",
  "won",
  "lost",
  "dormant",
]);

const LEAD_TEMPERATURE_SET = new Set<CrmLeadTemperature>(["hot", "warm", "cold"]);
const LEAD_SOURCE_SET = new Set<CrmLeadSource>(["walk-in", "referral", "ad", "instagram", "line", "google", "other"]);
const FOLLOWUP_TYPE_SET = new Set<CrmFollowupType>(["call", "message", "visit", "consult", "trial", "other"]);
const TRIAL_STATUS_SET = new Set<CrmTrialStatus>(["scheduled", "attended", "no_show", "canceled", "rescheduled"]);
const TRIAL_RESULT_SET = new Set<CrmTrialResult>(["interested", "follow_up_needed", "won", "lost"]);

export function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

export function parseLeadStatus(value: unknown, fallback: CrmLeadStatus = "new"): CrmLeadStatus {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase() as CrmLeadStatus;
  return LEAD_STATUS_SET.has(normalized) ? normalized : fallback;
}

export function parseLeadTemperature(value: unknown, fallback: CrmLeadTemperature = "warm"): CrmLeadTemperature {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase() as CrmLeadTemperature;
  return LEAD_TEMPERATURE_SET.has(normalized) ? normalized : fallback;
}

export function parseLeadSource(value: unknown, fallback: CrmLeadSource = "walk-in"): CrmLeadSource {
  if (typeof value !== "string") return fallback;
  const raw = value.trim().toLowerCase();
  const normalized = raw === "walkin" ? "walk-in" : raw;
  return LEAD_SOURCE_SET.has(normalized as CrmLeadSource) ? (normalized as CrmLeadSource) : fallback;
}

export function parseFollowupType(value: unknown, fallback: CrmFollowupType = "other"): CrmFollowupType {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase() as CrmFollowupType;
  return FOLLOWUP_TYPE_SET.has(normalized) ? normalized : fallback;
}

export function parseTrialStatus(value: unknown): CrmTrialStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as CrmTrialStatus;
  return TRIAL_STATUS_SET.has(normalized) ? normalized : null;
}

export function parseTrialResult(value: unknown): CrmTrialResult | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as CrmTrialResult;
  return TRIAL_RESULT_SET.has(normalized) ? normalized : null;
}

export function parseIsoDateTime(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function toLegacyLeadStatus(params: { status: CrmLeadStatus; trialStatus: CrmTrialStatus | null }): "new" | "tour_scheduled" | "converted" | "lost" {
  if (params.status === "won") return "converted";
  if (params.status === "lost") return "lost";
  if (
    params.status === "trial_booked" ||
    params.status === "trial_completed" ||
    params.trialStatus === "scheduled" ||
    params.trialStatus === "rescheduled" ||
    params.trialStatus === "attended"
  ) {
    return "tour_scheduled";
  }
  return "new";
}

export function canManageAllCrm(context: Pick<ProfileContext, "role">) {
  return context.role === "platform_admin" || context.role === "manager";
}

export function enforceCrmOwnerScope(params: {
  context: Pick<ProfileContext, "role" | "userId">;
  ownerStaffId: string | null;
  createdBy: string | null;
}) {
  if (params.context.role !== "sales") return true;
  return params.ownerStaffId === params.context.userId || params.createdBy === params.context.userId;
}

export function enforceCrmBranchScope(params: {
  context: Pick<ProfileContext, "role" | "branchId">;
  branchId: string | null;
}) {
  if (!params.context.branchId) return true;
  if (params.context.role === "platform_admin" || params.context.role === "manager") return true;
  return params.branchId === null || params.branchId === params.context.branchId;
}

export function canAssignCrmOwner(role: AppRole) {
  return role === "platform_admin" || role === "manager";
}

