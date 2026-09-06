import {
  getBigeTrialOutcomeVisualState,
  isBigeTrialReminderConfirmed,
  type BigeTrialConversionOutcome,
} from "./bige-fitness";
import { normalizeEmployeeNumber } from "./staff-credentials";

export const BIGE_SCHEDULE_HOLO_PILOT_EMPLOYEE_NUMBER = "E000001";
export const BIGE_SCHEDULE_HOLO_PILOT_DATES = ["2026-09-06", "2026-09-07"] as const;
export const BIGE_SCHEDULE_HOLO_RESET_DELAY_MS = 1_000;
export const BIGE_SCHEDULE_HOLO_TILT_MAX_X_DEG = 2.2;
export const BIGE_SCHEDULE_HOLO_TILT_MAX_Y_DEG = 3.2;
export const BIGE_SCHEDULE_HOLO_TURN_DEG = -1.4;
export const BIGE_SCHEDULE_HOLO_HOVER_SCALE = 1.018;

const BIGE_SCHEDULE_HOLO_PILOT_DATE_SET = new Set<string>(
  BIGE_SCHEDULE_HOLO_PILOT_DATES,
);

export type BigeScheduleHoloTone =
  | "pt"
  | "fa"
  | "fa-reminded"
  | "fa-converted"
  | "fa-not-converted"
  | "fa-pending-conversion"
  | "bb"
  | "completed"
  | "no-show";

export function isBigeScheduleHoloPilotEnabled(input: {
  employeeNumber: string | null | undefined;
  businessDate: string;
  view: string;
  tab: string;
}) {
  return (
    normalizeEmployeeNumber(input.employeeNumber) ===
      BIGE_SCHEDULE_HOLO_PILOT_EMPLOYEE_NUMBER &&
    input.view === "manager" &&
    input.tab === "schedule" &&
    BIGE_SCHEDULE_HOLO_PILOT_DATE_SET.has(input.businessDate)
  );
}

export function resolveBigeScheduleHoloTone(input: {
  operationKind: "pt" | "trial" | "bb";
  status: string | null | undefined;
  reminderStatus?: string | null;
  convertedAt?: string | null;
  trialOutcome?: BigeTrialConversionOutcome | null;
}): BigeScheduleHoloTone | null {
  if (input.status === "cancelled") return null;
  if (input.status === "no_show") return "no-show";

  if (input.operationKind === "trial") {
    const outcome = getBigeTrialOutcomeVisualState({
      convertedAt: input.convertedAt,
      outcome: input.trialOutcome,
    });
    if (outcome === "converted") return "fa-converted";
    if (outcome === "not_converted") return "fa-not-converted";
    if (outcome === "pending_conversion") return "fa-pending-conversion";
    if (input.status === "completed") return "completed";
    if (isBigeTrialReminderConfirmed(input.reminderStatus)) return "fa-reminded";
    return "fa";
  }

  if (input.status === "completed") return "completed";
  return input.operationKind === "bb" ? "bb" : "pt";
}
