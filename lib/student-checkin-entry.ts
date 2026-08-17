export type StudentCheckInEntryMode = "autonomous" | "drop_in";
export type StudentCheckInAdminDecision = "approved" | "rejected";
export type StudentDropInRejectionAction = "general" | "data_correction";
export type StudentCheckInAdminAlertScope = "none" | "autonomous" | "drop_in" | "all";

export const STUDENT_CHECKIN_ADMIN_PENDING_EVENT = "student-checkin-admin-pending-loaded";

export function studentCheckInPath(mode: StudentCheckInEntryMode) {
  return mode === "drop_in" ? "/check-in/drop-in" : "/check-in";
}

export function studentCheckInEntryLabel(mode: StudentCheckInEntryMode) {
  return mode === "drop_in" ? "50 元入場" : "學生自主訓練";
}

export function isStudentCheckInEntryMode(value: unknown): value is StudentCheckInEntryMode {
  return value === "autonomous" || value === "drop_in";
}

export function studentCheckInAdminAlertScope(
  pathname: string,
  autonomousPendingCount: number,
  dropInPendingCount: number,
): StudentCheckInAdminAlertScope {
  if (pathname === "/admin/student-check-ins/login") return "none";
  if (pathname === "/admin/student-check-ins") {
    return autonomousPendingCount > 0 ? "none" : dropInPendingCount > 0 ? "drop_in" : "none";
  }
  if (pathname === "/admin/student-check-ins/drop-in") {
    return dropInPendingCount > 0 ? "none" : autonomousPendingCount > 0 ? "autonomous" : "none";
  }
  return "all";
}

export function studentCheckInAdminDecisionRequest(
  mode: StudentCheckInEntryMode,
  requestId: string,
  decision: StudentCheckInAdminDecision,
  rejectionAction?: StudentDropInRejectionAction,
) {
  if (mode === "drop_in" && decision === "rejected" && !rejectionAction) {
    throw new Error("DROP_IN_REJECTION_ACTION_REQUIRED");
  }

  return {
    endpoint: mode === "drop_in"
      ? `/api/admin/student-check-ins/drop-in/${encodeURIComponent(requestId)}/decision`
      : `/api/admin/student-check-ins/${encodeURIComponent(requestId)}/decision`,
    body: mode === "drop_in" && decision === "rejected"
      ? { decision, rejectionAction }
      : { decision },
  };
}

export type StudentCheckInPendingQueueItem = {
  id: string;
  requested_at: string;
  mode: StudentCheckInEntryMode;
};

export function sortStudentCheckInPendingQueue<T extends StudentCheckInPendingQueueItem>(items: T[]) {
  return [...items].sort((left, right) => {
    const byTime = new Date(left.requested_at).getTime() - new Date(right.requested_at).getTime();
    if (byTime !== 0) return byTime;
    if (left.mode !== right.mode) return left.mode === "autonomous" ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}
