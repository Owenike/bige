export type MemberPlanType = "subscription" | "entry_pass" | "coach_pack" | "trial";

export type MemberContractStatus = "pending" | "active" | "frozen" | "expired" | "canceled" | "exhausted";

export type PlanFulfillmentKind = "subscription" | "entry_pass" | "none";

export type LedgerSourceType = "grant" | "redeem" | "adjustment" | "refund_reversal" | "expire" | "manual";

export interface PlanCatalogRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  plan_type: MemberPlanType;
  fulfillment_kind: PlanFulfillmentKind;
  default_duration_days: number | null;
  default_quantity: number | null;
  allow_auto_renew: boolean;
  is_active: boolean;
}

export interface ContractStatusInput {
  status: string | null | undefined;
  endsAt: string | null | undefined;
  remainingUses: number | null | undefined;
  remainingSessions: number | null | undefined;
  now?: Date;
}

const ALLOWED_PLAN_TYPES: MemberPlanType[] = ["subscription", "entry_pass", "coach_pack", "trial"];
const ALLOWED_FULFILLMENT_KINDS: PlanFulfillmentKind[] = ["subscription", "entry_pass", "none"];

export function normalizePlanType(value: unknown): MemberPlanType | null {
  if (typeof value !== "string") return null;
  return ALLOWED_PLAN_TYPES.includes(value as MemberPlanType) ? (value as MemberPlanType) : null;
}

export function normalizeFulfillmentKind(value: unknown): PlanFulfillmentKind | null {
  if (typeof value !== "string") return null;
  return ALLOWED_FULFILLMENT_KINDS.includes(value as PlanFulfillmentKind)
    ? (value as PlanFulfillmentKind)
    : null;
}

export function normalizeContractStatus(value: unknown): MemberContractStatus | null {
  if (typeof value !== "string") return null;
  if (
    value === "pending" ||
    value === "active" ||
    value === "frozen" ||
    value === "expired" ||
    value === "canceled" ||
    value === "exhausted"
  ) {
    return value;
  }
  return null;
}

export function addDays(base: Date, days: number) {
  return new Date(base.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1000);
}

export function evaluateContractStatus(input: ContractStatusInput): MemberContractStatus {
  const now = input.now ?? new Date();
  const normalized = normalizeContractStatus(input.status) ?? "active";
  if (normalized === "canceled" || normalized === "frozen" || normalized === "pending") return normalized;

  if (input.endsAt) {
    const ends = new Date(input.endsAt);
    if (!Number.isNaN(ends.getTime()) && ends.getTime() < now.getTime()) {
      return "expired";
    }
  }

  const remainingUses = typeof input.remainingUses === "number" ? input.remainingUses : null;
  const remainingSessions = typeof input.remainingSessions === "number" ? input.remainingSessions : null;
  if (remainingUses !== null && remainingUses <= 0) return "exhausted";
  if (remainingSessions !== null && remainingSessions <= 0) return "exhausted";

  return "active";
}

export function remainingDays(endsAt: string | null | undefined, now: Date = new Date()) {
  if (!endsAt) return null;
  const ends = new Date(endsAt);
  if (Number.isNaN(ends.getTime())) return null;
  const delta = ends.getTime() - now.getTime();
  return Math.ceil(delta / (24 * 60 * 60 * 1000));
}

