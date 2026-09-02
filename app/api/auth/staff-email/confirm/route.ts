import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { httpLogBase, logEvent } from "../../../../../lib/observability";
import { rateLimitShared } from "../../../../../lib/rate-limit";
import { canUseStaffAccountSettings } from "../../../../../lib/staff-credentials";
import {
  findConflictingEmailUser,
  loadStudentCheckinMergeCandidate,
  mergeStudentCheckinAuthAccount,
  type StudentCheckinMergeResult,
} from "../../../../../lib/staff-email-merge";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

function tokenHash(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (token.length < 32) {
    return NextResponse.json({ error: "驗證連結無效" }, { status: 400 });
  }

  const base = httpLogBase(request);
  const rateLimit = await rateLimitShared({
    key: `staff_email_confirm:${base.ip || "unknown"}:${token.slice(0, 16)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "操作次數過多，請稍後再試" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSec) },
      },
    );
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const hashedToken = tokenHash(token);
  const claimResult = await admin
    .from("staff_email_verification_tokens")
    .update({ used_at: now })
    .eq("token_hash", hashedToken)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id, profile_id, tenant_id, email, expires_at")
    .maybeSingle();
  if (claimResult.error) {
    return NextResponse.json({ error: claimResult.error.message }, { status: 500 });
  }
  if (!claimResult.data) {
    return NextResponse.json({ error: "驗證連結無效或已過期，請重新登入後寄送" }, { status: 400 });
  }

  const tokenRow = claimResult.data;
  const profileResult = await admin
    .from("profiles")
    .select("id, employee_number, is_active, staff_deleted_at, staff_activation_status")
    .eq("id", tokenRow.profile_id)
    .maybeSingle();
  if (
    profileResult.error ||
    !profileResult.data ||
    !profileResult.data.is_active ||
    profileResult.data.staff_deleted_at
  ) {
    return NextResponse.json({ error: "員工帳號不存在或已停用" }, { status: 403 });
  }
  const isAccountEmailChange = profileResult.data.staff_activation_status === "completed";
  if (
    isAccountEmailChange &&
    !canUseStaffAccountSettings(profileResult.data.employee_number)
  ) {
    return NextResponse.json(
      { error: "此帳號不提供信箱變更功能" },
      { status: 403 },
    );
  }

  const currentUserResult = await admin.auth.admin.getUserById(tokenRow.profile_id);
  if (currentUserResult.error || !currentUserResult.data.user) {
    return NextResponse.json(
      { error: currentUserResult.error?.message || "找不到登入帳號" },
      { status: 500 },
    );
  }
  const previousEmail = currentUserResult.data.user.email?.trim().toLowerCase() || null;
  let studentMerge: StudentCheckinMergeResult | null = null;

  try {
    const conflictingUser = await findConflictingEmailUser(
      admin,
      tokenRow.email,
      tokenRow.profile_id,
    );
    if (conflictingUser) {
      const mergeCandidate = !isAccountEmailChange
        ? await loadStudentCheckinMergeCandidate(
            admin,
            conflictingUser,
            tokenRow.profile_id,
            tokenRow.email,
          )
        : null;
      if (!mergeCandidate) {
        return NextResponse.json({ error: "此 Email 已由其他帳號使用" }, { status: 409 });
      }
      studentMerge = await mergeStudentCheckinAuthAccount(
        admin,
        mergeCandidate,
        tokenRow.profile_id,
        tokenRow.email,
      );
      logEvent("info", {
        type: "http",
        action: "staff_email_student_checkin_account_merged",
        ...base,
        status: 200,
        userId: tokenRow.profile_id,
        conflictingUserId: studentMerge.sourceUserId,
        studentProfileId: studentMerge.studentProfileId,
      });
      if (studentMerge.sourceBanError) {
        logEvent("warn", {
          type: "http",
          action: "staff_email_student_checkin_archive_ban_failed",
          ...base,
          status: 500,
          userId: tokenRow.profile_id,
          conflictingUserId: studentMerge.sourceUserId,
          error: studentMerge.sourceBanError,
        });
      }
    }
  } catch (error) {
    await admin
      .from("staff_email_verification_tokens")
      .update({ used_at: null })
      .eq("id", tokenRow.id);
    logEvent("warn", {
      type: "http",
      action: "staff_email_student_checkin_merge_failed",
      ...base,
      status: 500,
      userId: tokenRow.profile_id,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      { error: "合併既有報到帳號失敗，請稍後再試" },
      { status: 500 },
    );
  }

  if (!studentMerge) {
    const authUpdate = await admin.auth.admin.updateUserById(tokenRow.profile_id, {
      email: tokenRow.email,
      email_confirm: true,
    });
    if (authUpdate.error) {
      await admin
        .from("staff_email_verification_tokens")
        .update({ used_at: null })
        .eq("id", tokenRow.id);
      return NextResponse.json({ error: "更新登入信箱失敗，請稍後再試" }, { status: 500 });
    }
  }

  const profileUpdate = await admin
    .from("profiles")
    .update({
      staff_email_verified_at: now,
      updated_at: now,
    })
    .eq("id", tokenRow.profile_id);
  if (profileUpdate.error) {
    await admin
      .from("staff_email_verification_tokens")
      .update({ used_at: null })
      .eq("id", tokenRow.id);
    return NextResponse.json({ error: "更新員工資料失敗，請稍後再試" }, { status: 500 });
  }

  const signInLink = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: tokenRow.email,
  });
  if (signInLink.error || !signInLink.data.properties?.hashed_token) {
    await admin
      .from("staff_email_verification_tokens")
      .update({ used_at: null })
      .eq("id", tokenRow.id);
    return NextResponse.json(
      { error: "建立員工啟用工作階段失敗，請重新開啟驗證連結" },
      { status: 500 },
    );
  }

  const sessionClient = await createSupabaseServerClient(request);
  const sessionResult = await sessionClient.auth.verifyOtp({
    token_hash: signInLink.data.properties.hashed_token,
    type: "magiclink",
  });
  if (sessionResult.error || !sessionResult.data.user) {
    await admin
      .from("staff_email_verification_tokens")
      .update({ used_at: null })
      .eq("id", tokenRow.id);
    return NextResponse.json(
      { error: "建立員工啟用工作階段失敗，請重新開啟驗證連結" },
      { status: 500 },
    );
  }

  await admin.from("audit_logs").insert({
    tenant_id: tokenRow.tenant_id,
    actor_id: tokenRow.profile_id,
    action: isAccountEmailChange ? "staff_email_changed" : "staff_email_verified",
    target_type: "profile",
    target_id: tokenRow.profile_id,
    reason: isAccountEmailChange ? "self_service" : null,
    payload: isAccountEmailChange
      ? {
          previousEmail,
          newEmail: tokenRow.email,
          changedAt: now,
        }
      : {
          verifiedAt: now,
          mergedStudentCheckinUserId: studentMerge?.sourceUserId || null,
          mergedStudentProfileId: studentMerge?.studentProfileId || null,
        },
  });

  if (studentMerge) {
    await admin.from("audit_logs").insert({
      tenant_id: tokenRow.tenant_id,
      actor_id: tokenRow.profile_id,
      action: "staff_student_checkin_account_merged",
      target_type: "auth_user",
      target_id: studentMerge.sourceUserId,
      reason: "verified_staff_email_claim",
      payload: {
        mergedIntoUserId: tokenRow.profile_id,
        studentProfileId: studentMerge.studentProfileId,
      },
    });
  }

  return NextResponse.json({
    verified: true,
    sessionReady: true,
    mode: isAccountEmailChange ? "email_change" : "activation",
  });
}
