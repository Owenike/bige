import { sendNotification } from "./integrations/notify";
import { appOrigin } from "./student-checkin";
import { studentCheckInEntryLabel, type StudentCheckInEntryMode } from "./student-checkin-entry";
import {
  createStudentEmailVerificationToken,
  hashStudentEmailVerificationToken,
  studentEmailVerificationExpiry,
} from "./student-checkin-email-verification";
import { createSupabaseAdminClient } from "./supabase/admin";

export const STUDENT_SECURITY_SETUP_MAX_EMAIL_SENDS = 8;

export type StudentSecuritySetupRow = {
  id: string;
  profile_id: string;
  auth_user_id: string;
  previous_email: string | null;
  pending_email: string;
  pending_password_hash: string | null;
  verification_token_hash: string;
  status: "pending" | "verifying" | "completed" | "cancelled";
  expires_at: string;
  last_email_sent_at: string;
  email_send_count: number;
  verified_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const studentSecuritySetupSelect =
  "id, profile_id, auth_user_id, previous_email, pending_email, pending_password_hash, verification_token_hash, status, expires_at, last_email_sent_at, email_send_count, verified_at, completed_at, created_at, updated_at";

export function createStudentSecuritySetupToken() {
  return createStudentEmailVerificationToken();
}

export function hashStudentSecuritySetupToken(token: string) {
  return hashStudentEmailVerificationToken(token);
}

export function studentSecuritySetupExpiry() {
  return studentEmailVerificationExpiry();
}

export async function loadActiveStudentSecuritySetup(profileId: string) {
  const result = await createSupabaseAdminClient()
    .from("student_checkin_security_setups")
    .select(studentSecuritySetupSelect)
    .eq("profile_id", profileId)
    .in("status", ["pending", "verifying"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentSecuritySetupRow | null;
}

export async function cancelActiveStudentSecuritySetup(profileId: string) {
  const now = new Date().toISOString();
  const result = await createSupabaseAdminClient()
    .from("student_checkin_security_setups")
    .update({ status: "cancelled", updated_at: now })
    .eq("profile_id", profileId)
    .in("status", ["pending", "verifying"]);
  if (result.error) throw new Error(result.error.message);
}

export async function isAuthEmailUsedByAnotherUser(email: string, authUserId: string) {
  const normalized = email.trim().toLowerCase();
  const admin = createSupabaseAdminClient();
  const perPage = 1000;

  for (let page = 1; page <= 10; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage });
    if (result.error) throw new Error(result.error.message);
    if (result.data.users.some((user) => user.id !== authUserId && user.email?.trim().toLowerCase() === normalized)) {
      return true;
    }
    if (result.data.users.length < perPage) return false;
  }

  throw new Error("帳號數量超出 Email 唯一性檢查範圍，請洽管理員。");
}

export async function sendStudentSecuritySetupVerification(input: {
  request: Request;
  email: string;
  fullName: string;
  token: string;
  entryMode: StudentCheckInEntryMode;
}) {
  const verificationUrl = new URL("/check-in/security-setup/verify", appOrigin(input.request));
  verificationUrl.searchParams.set("token", input.token);
  verificationUrl.searchParams.set("entry", input.entryMode);
  const entryLabel = studentCheckInEntryLabel(input.entryMode);

  const message = [
    `${input.fullName} 您好：`,
    "",
    `您正在完成 BIG E FITNESS ${entryLabel}帳號的安全設定。`,
    `請點擊下方連結驗證 Email。驗證完成後，新 Email 與新密碼才會正式啟用，並開啟${entryLabel}入口。`,
    "",
    verificationUrl.toString(),
    "",
    "此連結 30 分鐘內有效，且只能完成一次。",
    "若不是您本人操作，請勿點擊連結，並立即聯絡現場人員。",
  ].join("\n");

  return sendNotification({
    channel: "email",
    target: input.email,
    templateKey: `【BIG E FITNESS】${entryLabel}帳號安全設定`,
    message,
  });
}
