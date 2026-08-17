import { createSupabaseAdminClient } from "./supabase/admin";
import type { StudentAuthMethod } from "./student-checkin";
import {
  isStudentDropInRegistrationComplete,
  type StudentDropInActivityInterest,
  type StudentDropInGender,
} from "./student-drop-in-registration";
import {
  DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN,
  studentDropInPlanDetails,
  studentDropInRemainingUses,
  type StudentDropInEntryPlan,
} from "./student-drop-in-plan";

export const STUDENT_DROP_IN_MAX_USES = 10;
export const STUDENT_DROP_IN_PRICE_TWD = 50;
const RECENT_REQUEST_WINDOW_MS = 30 * 60 * 1000;

export type StudentDropInEntitlementRow = {
  student_profile_id: string;
  total_uses: number;
  used_uses: number;
  entry_plan: StudentDropInEntryPlan;
  review_photo_path: string | null;
  review_photo_uploaded_at: string | null;
  invoice_carrier: string | null;
  gender: StudentDropInGender | null;
  activity_interest: StudentDropInActivityInterest | null;
  discovery_source: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  registration_correction_required: boolean;
  correction_requested_at: string | null;
};

export type StudentDropInRequestRow = {
  id: string;
  student_profile_id: string;
  status: "pending" | "approved" | "rejected";
  auth_method: Exclude<StudentAuthMethod, "line">;
  requested_at: string;
  reviewed_at: string | null;
};

export type StudentDropInRow = {
  id: string;
  request_id: string;
  student_profile_id: string;
  checked_in_at: string;
  local_date: string;
  use_sequence: number;
  remaining_uses: number | null;
  price_twd: number;
  entry_plan: StudentDropInEntryPlan;
};

const entitlementSelect =
  "student_profile_id, total_uses, used_uses, entry_plan, review_photo_path, review_photo_uploaded_at, invoice_carrier, gender, activity_interest, discovery_source, terms_version, terms_accepted_at, registration_correction_required, correction_requested_at";
const requestSelect =
  "id, student_profile_id, status, auth_method, requested_at, reviewed_at";
const dropInSelect =
  "id, request_id, student_profile_id, checked_in_at, local_date, use_sequence, remaining_uses, price_twd, entry_plan";

export function remainingStudentDropInUses(
  entitlement: Pick<StudentDropInEntitlementRow, "total_uses" | "used_uses" | "entry_plan"> | null,
) {
  if (!entitlement) return STUDENT_DROP_IN_MAX_USES;
  return studentDropInRemainingUses({
    plan: entitlement.entry_plan,
    totalUses: entitlement.total_uses,
    usedUses: entitlement.used_uses,
  });
}

export function publicStudentDropInRegistration(entitlement: StudentDropInEntitlementRow | null) {
  return {
    complete: isStudentDropInRegistrationComplete(entitlement),
    invoiceCarrier: entitlement?.invoice_carrier || "",
    gender: entitlement?.gender || null,
    activityInterest: entitlement?.activity_interest || null,
    discoverySource: entitlement?.discovery_source || "",
    termsVersion: entitlement?.terms_version || null,
    termsAcceptedAt: entitlement?.terms_accepted_at || null,
    correctionRequired: entitlement?.registration_correction_required === true,
    correctionRequestedAt: entitlement?.correction_requested_at || null,
    entryPlan: entitlement?.entry_plan || DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN,
  };
}

export async function loadStudentDropInEntitlement(profileId: string) {
  const result = await createSupabaseAdminClient()
    .from("student_drop_in_entitlements")
    .select(entitlementSelect)
    .eq("student_profile_id", profileId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentDropInEntitlementRow | null;
}

export async function ensureStudentDropInEntitlement(profileId: string) {
  const admin = createSupabaseAdminClient();
  const inserted = await admin
    .from("student_drop_in_entitlements")
    .insert({ student_profile_id: profileId });
  if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message);

  const entitlement = await loadStudentDropInEntitlement(profileId);
  if (!entitlement) throw new Error("Unable to create drop-in entitlement");
  return entitlement;
}

export async function loadRecentStudentDropInRequest(profileId: string) {
  const cutoff = new Date(Date.now() - RECENT_REQUEST_WINDOW_MS).toISOString();
  const result = await createSupabaseAdminClient()
    .from("student_drop_in_requests")
    .select(requestSelect)
    .eq("student_profile_id", profileId)
    .gte("requested_at", cutoff)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentDropInRequestRow | null;
}

export async function loadPendingStudentDropInRequest(profileId: string) {
  const result = await createSupabaseAdminClient()
    .from("student_drop_in_requests")
    .select(requestSelect)
    .eq("student_profile_id", profileId)
    .eq("status", "pending")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentDropInRequestRow | null;
}

export async function loadApprovedStudentDropIn(requestId: string) {
  const result = await createSupabaseAdminClient()
    .from("student_drop_ins")
    .select(dropInSelect)
    .eq("request_id", requestId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentDropInRow | null;
}

export async function createStudentDropInRequest(input: {
  profileId: string;
  authMethod: Exclude<StudentAuthMethod, "line">;
  request: Request;
}) {
  const admin = createSupabaseAdminClient();
  const entitlement = await ensureStudentDropInEntitlement(input.profileId);
  if (!isStudentDropInRegistrationComplete(entitlement)) {
    throw new Error("DROP_IN_REGISTRATION_REQUIRED");
  }
  const plan = studentDropInPlanDetails(entitlement.entry_plan);
  const remainingUses = remainingStudentDropInUses(entitlement);
  if (!plan.unlimitedUses && remainingUses !== null && remainingUses <= 0) {
    throw new Error("DROP_IN_USES_EXHAUSTED");
  }

  const existing = await loadPendingStudentDropInRequest(input.profileId);
  if (existing) return existing;

  const recent = await loadRecentStudentDropInRequest(input.profileId);
  if (recent?.status === "approved") return recent;

  const inserted = await admin
    .from("student_drop_in_requests")
    .insert({
      student_profile_id: input.profileId,
      auth_method: input.authMethod,
      user_agent: input.request.headers.get("user-agent") || null,
      ip_address: input.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    })
    .select(requestSelect)
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const raced = await loadPendingStudentDropInRequest(input.profileId);
      if (raced) return raced;
    }
    throw new Error(inserted.error.message);
  }
  return inserted.data as StudentDropInRequestRow;
}
