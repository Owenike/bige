import type { User } from "@supabase/supabase-js";
import type { createSupabaseAdminClient } from "./supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type StudentCheckinLinkRow = {
  id: string;
  auth_user_id: string | null;
};

type StudentCheckinRegistrationRow = StudentCheckinLinkRow & {
  profile_id: string;
  email: string;
  status: string;
};

export type StudentCheckinMergeCandidate = {
  sourceUser: User;
  studentProfileId: string;
  registrationId: string;
};

export type StudentCheckinMergeResult = {
  archivedEmail: string;
  sourceUserId: string;
  sourceBanError: string | null;
  studentProfileId: string;
};

const AUTH_USER_PAGE_SIZE = 200;
const AUTH_USER_MAX_PAGES = 20;
const ARCHIVED_STUDENT_EMAIL_DOMAIN = "staff.bigefitness.invalid";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function metadataRegistrationId(metadata: User["app_metadata"]) {
  const value = metadata?.registration_id;
  return typeof value === "string" ? value.trim() : "";
}

export function isStudentCheckinMergeMetadata(metadata: User["app_metadata"]) {
  return (
    metadata?.account_type === "student_checkin" &&
    metadataRegistrationId(metadata).length > 0
  );
}

export function studentCheckinArchivedEmail(userId: string) {
  const compactId = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toLowerCase();
  return `student-checkin-archived-${compactId}@${ARCHIVED_STUDENT_EMAIL_DOMAIN}`;
}

export function archivedStudentCheckinAppMetadata(
  metadata: User["app_metadata"],
  targetUserId: string,
) {
  const archived: Record<string, unknown> = {
    ...metadata,
    account_type: "student_checkin_archived",
    archived_into_user_id: targetUserId,
  };
  delete archived.registration_id;
  delete archived.entry_mode;
  return archived;
}

export async function findConflictingEmailUser(
  admin: SupabaseAdminClient,
  email: string,
  currentUserId: string,
) {
  const normalizedEmail = normalizeEmail(email);
  for (let page = 1; page <= AUTH_USER_MAX_PAGES; page += 1) {
    const result = await admin.auth.admin.listUsers({
      page,
      perPage: AUTH_USER_PAGE_SIZE,
    });
    if (result.error) throw result.error;
    const users = result.data.users || [];
    const conflictingUser = users.find(
      (user) =>
        user.id !== currentUserId &&
        normalizeEmail(user.email) === normalizedEmail,
    );
    if (conflictingUser) return conflictingUser;
    if (users.length < AUTH_USER_PAGE_SIZE) return null;
  }
  return null;
}

export async function loadStudentCheckinMergeCandidate(
  admin: SupabaseAdminClient,
  sourceUser: User,
  targetUserId: string,
  requestedEmail: string,
): Promise<StudentCheckinMergeCandidate | null> {
  const registrationId = metadataRegistrationId(sourceUser.app_metadata);
  if (
    !isStudentCheckinMergeMetadata(sourceUser.app_metadata) ||
    !sourceUser.email_confirmed_at ||
    normalizeEmail(sourceUser.email) !== normalizeEmail(requestedEmail)
  ) {
    return null;
  }

  const [staffProfile, member, sourceStudent, targetStudent, registration] =
    await Promise.all([
      admin.from("profiles").select("id").eq("id", sourceUser.id).maybeSingle(),
      admin
        .from("members")
        .select("id")
        .eq("auth_user_id", sourceUser.id)
        .limit(1)
        .maybeSingle(),
      admin
        .from("student_line_profiles")
        .select("id, auth_user_id, email")
        .eq("auth_user_id", sourceUser.id)
        .maybeSingle(),
      admin
        .from("student_line_profiles")
        .select("id, auth_user_id, email")
        .eq("auth_user_id", targetUserId)
        .maybeSingle(),
      admin
        .from("student_checkin_email_verifications")
        .select("id, profile_id, auth_user_id, email, status")
        .eq("id", registrationId)
        .maybeSingle(),
    ]);

  const firstError = [
    staffProfile.error,
    member.error,
    sourceStudent.error,
    targetStudent.error,
    registration.error,
  ].find(Boolean);
  if (firstError) throw firstError;
  if (staffProfile.data || member.data) return null;

  const sourceStudentRow = sourceStudent.data as
    | (StudentCheckinLinkRow & { email: string | null })
    | null;
  const targetStudentRow = targetStudent.data as
    | (StudentCheckinLinkRow & { email: string | null })
    | null;
  if (sourceStudentRow && targetStudentRow) return null;
  const studentProfile = sourceStudentRow || targetStudentRow;
  const registrationRow = registration.data as StudentCheckinRegistrationRow | null;
  if (
    !studentProfile ||
    !registrationRow ||
    registrationRow.status !== "completed" ||
    registrationRow.profile_id !== studentProfile.id ||
    ![sourceUser.id, targetUserId].includes(registrationRow.auth_user_id || "") ||
    normalizeEmail(studentProfile.email) !== normalizeEmail(requestedEmail) ||
    normalizeEmail(registrationRow.email) !== normalizeEmail(requestedEmail)
  ) {
    return null;
  }

  return {
    sourceUser,
    studentProfileId: studentProfile.id,
    registrationId: registrationRow.id,
  };
}

async function moveStudentCheckinLinks(
  admin: SupabaseAdminClient,
  candidate: StudentCheckinMergeCandidate,
  fromUserId: string,
  toUserId: string,
) {
  const writeLinks = async (sourceUserId: string, destinationUserId: string) => {
    const updatedAt = new Date().toISOString();
    return Promise.all([
      admin
        .from("student_line_profiles")
        .update({ auth_user_id: destinationUserId, updated_at: updatedAt })
        .eq("id", candidate.studentProfileId)
        .eq("auth_user_id", sourceUserId),
      admin
        .from("student_checkin_email_verifications")
        .update({ auth_user_id: destinationUserId, updated_at: updatedAt })
        .eq("id", candidate.registrationId)
        .eq("auth_user_id", sourceUserId),
      admin
        .from("student_checkin_security_setups")
        .update({ auth_user_id: destinationUserId, updated_at: updatedAt })
        .eq("profile_id", candidate.studentProfileId)
        .eq("auth_user_id", sourceUserId),
    ]);
  };

  const rollbackLinks = async () => {
    await writeLinks(toUserId, fromUserId);
  };

  const results = await writeLinks(fromUserId, toUserId);
  const firstError = results.map((result) => result.error).find(Boolean);
  if (firstError) {
    await rollbackLinks().catch(() => null);
    throw firstError;
  }

  const [profileResult, registrationResult] = await Promise.all([
    admin
      .from("student_line_profiles")
      .select("auth_user_id")
      .eq("id", candidate.studentProfileId)
      .maybeSingle(),
    admin
      .from("student_checkin_email_verifications")
      .select("auth_user_id")
      .eq("id", candidate.registrationId)
      .maybeSingle(),
  ]);
  if (profileResult.error || registrationResult.error) {
    await rollbackLinks().catch(() => null);
    throw profileResult.error || registrationResult.error;
  }
  if (
    profileResult.data?.auth_user_id !== toUserId ||
    registrationResult.data?.auth_user_id !== toUserId
  ) {
    await rollbackLinks().catch(() => null);
    throw new Error("Student check-in account links were not fully transferred");
  }
}

export async function mergeStudentCheckinAuthAccount(
  admin: SupabaseAdminClient,
  candidate: StudentCheckinMergeCandidate,
  targetUserId: string,
  targetEmail: string,
): Promise<StudentCheckinMergeResult> {
  const sourceUser = candidate.sourceUser;
  const archivedEmail = studentCheckinArchivedEmail(sourceUser.id);
  let linksMoved = false;

  await moveStudentCheckinLinks(admin, candidate, sourceUser.id, targetUserId);
  linksMoved = true;

  const archiveResult = await admin.auth.admin.updateUserById(sourceUser.id, {
    email: archivedEmail,
    email_confirm: true,
    app_metadata: archivedStudentCheckinAppMetadata(
      sourceUser.app_metadata,
      targetUserId,
    ),
  });
  if (archiveResult.error) {
    if (linksMoved) {
      await moveStudentCheckinLinks(
        admin,
        candidate,
        targetUserId,
        sourceUser.id,
      ).catch(() => null);
    }
    throw archiveResult.error;
  }

  const targetResult = await admin.auth.admin.updateUserById(targetUserId, {
    email: normalizeEmail(targetEmail),
    email_confirm: true,
  });
  if (targetResult.error) {
    const restoreSource = await admin.auth.admin.updateUserById(sourceUser.id, {
      email: normalizeEmail(sourceUser.email),
      email_confirm: true,
      app_metadata: sourceUser.app_metadata,
    });
    if (!restoreSource.error) {
      await moveStudentCheckinLinks(
        admin,
        candidate,
        targetUserId,
        sourceUser.id,
      ).catch(() => null);
    }
    throw targetResult.error;
  }

  const banResult = await admin.auth.admin.updateUserById(sourceUser.id, {
    ban_duration: "876000h",
  });
  return {
    archivedEmail,
    sourceUserId: sourceUser.id,
    sourceBanError: banResult.error?.message || null,
    studentProfileId: candidate.studentProfileId,
  };
}
