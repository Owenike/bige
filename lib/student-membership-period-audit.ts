import type { SupabaseClient } from "@supabase/supabase-js";

export type StudentMembershipPeriodAuditOutcome =
  | "saved"
  | "updated"
  | "invalid"
  | "already_locked"
  | "not_found"
  | "conflict"
  | "database_error";

type MembershipPeriodSnapshot = {
  startsOn: string | null;
  expiresOn: string | null;
};

export async function writeStudentMembershipPeriodAuditNonBlocking(params: {
  supabase: SupabaseClient;
  tenantId: string | null;
  actorId: string;
  actorRole: string;
  studentProfileId: string;
  outcome: StudentMembershipPeriodAuditOutcome;
  attempted: MembershipPeriodSnapshot;
  previous?: MembershipPeriodSnapshot | null;
  error?: string | null;
}) {
  const action = params.outcome === "saved" || params.outcome === "updated"
    ? "student_membership_period_saved"
    : params.outcome === "database_error"
      ? "student_membership_period_save_failed"
      : "student_membership_period_save_blocked";

  try {
    const result = await params.supabase.from("audit_logs").insert({
      tenant_id: params.tenantId,
      actor_id: params.actorId,
      action,
      target_type: "student_line_profile",
      target_id: params.studentProfileId,
      reason: params.outcome,
      payload: {
        outcome: params.outcome,
        actorRole: params.actorRole,
        attempted: params.attempted,
        previous: params.previous ?? null,
        error: params.error ?? null,
      },
    });

    if (result.error) {
      console.warn("[student-membership-period-audit][write-failed]", {
        studentProfileId: params.studentProfileId,
        outcome: params.outcome,
        error: result.error.message,
      });
    }
  } catch (error) {
    console.warn("[student-membership-period-audit][write-failed]", {
      studentProfileId: params.studentProfileId,
      outcome: params.outcome,
      error: error instanceof Error ? error.message : "Unknown audit error",
    });
  }
}
