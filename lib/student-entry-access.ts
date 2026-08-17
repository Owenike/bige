import { createSupabaseAdminClient } from "./supabase/admin";
import type { StudentCheckInEntryMode } from "./student-checkin-entry";
import { normalizeStudentPhone } from "./student-phone";

export const STUDENT_ACCOUNT_UNAVAILABLE = {
  code: "account_unavailable",
  error: "帳號狀態異常，請洽現場人員協助確認。",
} as const;

export const STUDENT_NOT_OFFICIAL_MEMBER = {
  code: "not_official_member",
  error: "非本館學員，請掃描 50 元入場專用 QR Code，完成資料填寫與現場付款後等待確認。",
} as const;

export const STUDENT_AUTONOMOUS_ACCESS_REQUIRED = {
  code: "autonomous_access_required",
  error: "此帳號目前無法使用自主訓練，請改用 50 元入場專用 QR Code。",
} as const;

export type StudentEntryAccessCode =
  | "allowed"
  | typeof STUDENT_ACCOUNT_UNAVAILABLE.code
  | typeof STUDENT_NOT_OFFICIAL_MEMBER.code
  | typeof STUDENT_AUTONOMOUS_ACCESS_REQUIRED.code;

export type StudentEntryAccessSnapshot = {
  isBlocked: boolean;
  isFormalMember: boolean;
  memberId: string | null;
};

export type StudentEntryAccessDecision = StudentEntryAccessSnapshot & {
  allowed: boolean;
  code: StudentEntryAccessCode;
};

type MemberIdentity = {
  fullName: string;
  phone: string;
  email: string | null;
  birthDate: string | null;
};

type FormalMemberRow = {
  id: string;
  full_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  birth_date: string | null;
};

export type StudentMemberMatch = {
  memberId: string;
  matchMethod: "phone" | "email_birth" | "name_birth" | "unique_name";
};

export function classifyStudentEntryAccess(input: {
  mode: StudentCheckInEntryMode;
  isBlocked: boolean;
  isFormalMember: boolean;
  autonomousEnabled: boolean;
}): StudentEntryAccessCode {
  if (input.isBlocked) return STUDENT_ACCOUNT_UNAVAILABLE.code;
  if (input.mode === "drop_in") return "allowed";
  if (!input.isFormalMember) return STUDENT_NOT_OFFICIAL_MEMBER.code;
  if (!input.autonomousEnabled) return STUDENT_AUTONOMOUS_ACCESS_REQUIRED.code;
  return "allowed";
}

export function studentEntryAccessPublicError(code: StudentEntryAccessCode) {
  if (code === STUDENT_ACCOUNT_UNAVAILABLE.code) return STUDENT_ACCOUNT_UNAVAILABLE;
  if (code === STUDENT_NOT_OFFICIAL_MEMBER.code) return STUDENT_NOT_OFFICIAL_MEMBER;
  if (code === STUDENT_AUTONOMOUS_ACCESS_REQUIRED.code) return STUDENT_AUTONOMOUS_ACCESS_REQUIRED;
  return null;
}

export function studentEntryAccessDatabaseCode(error: unknown): StudentEntryAccessCode | null {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("STUDENT_ENTRY_BLOCKED")) return STUDENT_ACCOUNT_UNAVAILABLE.code;
  if (message.includes("STUDENT_NOT_OFFICIAL_MEMBER")) return STUDENT_NOT_OFFICIAL_MEMBER.code;
  return null;
}

function uniqueMatch(rows: FormalMemberRow[]) {
  const ids = [...new Set(rows.map((row) => row.id))];
  return ids.length === 1 ? ids[0] : null;
}

export function matchFormalMemberIdentity(rows: FormalMemberRow[], identity: MemberIdentity): StudentMemberMatch | null {
  const normalizedPhone = normalizeStudentPhone(identity.phone);
  const normalizedEmail = identity.email?.trim().toLowerCase() || null;
  const fullName = identity.fullName.trim();

  const phoneMatch = uniqueMatch(
    rows.filter((row) => {
      const memberPhone = normalizeStudentPhone(row.phone_normalized || row.phone || "");
      return Boolean(normalizedPhone && memberPhone === normalizedPhone);
    }),
  );
  if (phoneMatch) return { memberId: phoneMatch, matchMethod: "phone" };

  if (normalizedEmail && identity.birthDate) {
    const emailBirthMatch = uniqueMatch(
      rows.filter(
        (row) =>
          row.email?.trim().toLowerCase() === normalizedEmail &&
          row.birth_date === identity.birthDate,
      ),
    );
    if (emailBirthMatch) return { memberId: emailBirthMatch, matchMethod: "email_birth" };
  }

  if (identity.birthDate) {
    const nameBirthMatch = uniqueMatch(
      rows.filter((row) => row.full_name.trim() === fullName && row.birth_date === identity.birthDate),
    );
    if (nameBirthMatch) return { memberId: nameBirthMatch, matchMethod: "name_birth" };
  }

  const uniqueNameMatch = uniqueMatch(rows.filter((row) => row.full_name.trim() === fullName));
  return uniqueNameMatch ? { memberId: uniqueNameMatch, matchMethod: "unique_name" } : null;
}

export async function findFormalMemberForIdentity(identity: MemberIdentity) {
  const result = await createSupabaseAdminClient()
    .from("members")
    .select("id, full_name, phone, phone_normalized, email, birth_date")
    .eq("is_prospect", false)
    .limit(2000);
  if (result.error) throw new Error(result.error.message);
  return matchFormalMemberIdentity((result.data || []) as FormalMemberRow[], identity);
}

export async function ensureStudentMemberLink(
  studentProfileId: string,
  match: StudentMemberMatch,
) {
  const admin = createSupabaseAdminClient();
  const existing = await admin
    .from("student_checkin_member_links")
    .select("member_id")
    .eq("student_profile_id", studentProfileId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data.member_id === match.memberId;

  const inserted = await admin.from("student_checkin_member_links").insert({
    student_profile_id: studentProfileId,
    member_id: match.memberId,
    match_method: match.matchMethod,
  });
  if (!inserted.error) return true;
  if (inserted.error.code === "23505") return false;
  throw new Error(inserted.error.message);
}

export async function loadStudentEntryAccessSnapshot(studentProfileId: string): Promise<StudentEntryAccessSnapshot> {
  const admin = createSupabaseAdminClient();
  const [blockResult, linkResult] = await Promise.all([
    admin
      .from("student_checkin_access_blocks")
      .select("student_profile_id")
      .eq("student_profile_id", studentProfileId)
      .eq("is_active", true)
      .maybeSingle(),
    admin
      .from("student_checkin_member_links")
      .select("member_id")
      .eq("student_profile_id", studentProfileId)
      .maybeSingle(),
  ]);
  if (blockResult.error) throw new Error(blockResult.error.message);
  if (linkResult.error) throw new Error(linkResult.error.message);

  const memberId = linkResult.data?.member_id || null;
  if (!memberId) {
    return {
      isBlocked: Boolean(blockResult.data),
      isFormalMember: false,
      memberId: null,
    };
  }

  const memberResult = await admin
    .from("members")
    .select("id, is_prospect")
    .eq("id", memberId)
    .maybeSingle();
  if (memberResult.error) throw new Error(memberResult.error.message);

  return {
    isBlocked: Boolean(blockResult.data),
    isFormalMember: Boolean(memberResult.data && memberResult.data.is_prospect === false),
    memberId,
  };
}

export async function evaluateStudentEntryAccess(input: {
  studentProfileId: string;
  mode: StudentCheckInEntryMode;
  autonomousEnabled: boolean;
}): Promise<StudentEntryAccessDecision> {
  const snapshot = await loadStudentEntryAccessSnapshot(input.studentProfileId);
  const code = classifyStudentEntryAccess({
    mode: input.mode,
    isBlocked: snapshot.isBlocked,
    isFormalMember: snapshot.isFormalMember,
    autonomousEnabled: input.autonomousEnabled,
  });
  return { ...snapshot, code, allowed: code === "allowed" };
}
