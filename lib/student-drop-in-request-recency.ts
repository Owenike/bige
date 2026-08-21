export const STUDENT_DROP_IN_RECENT_DECISION_WINDOW_MS = 30 * 60 * 1000;

type StudentDropInRequestRecencyInput = {
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  reviewed_at: string | null;
};

export function shouldReuseStudentDropInRequest(
  request: StudentDropInRequestRecencyInput,
  nowMs = Date.now(),
) {
  if (request.status === "pending") return true;

  const decisionAtMs = Date.parse(request.reviewed_at || request.requested_at);
  if (!Number.isFinite(decisionAtMs)) return false;
  return nowMs - decisionAtMs <= STUDENT_DROP_IN_RECENT_DECISION_WINDOW_MS;
}
