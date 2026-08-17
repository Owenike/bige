import { NextResponse } from "next/server";
import { z } from "zod";
import { bigeFacilityClosedMessage, isBigeFacilityClosed } from "../../../../lib/bige-business-day";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";
import { ensureStudentDropInEntitlement } from "../../../../lib/student-drop-in";
import {
  loadStudentProfileById,
  setStudentAuthSession,
} from "../../../../lib/student-checkin";
import {
  clearPendingStudentRegistrationCookie,
  hashStudentEmailVerificationToken,
  studentEmailVerificationSelect,
  type StudentEmailVerificationRow,
} from "../../../../lib/student-checkin-email-verification";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import {
  ensureStudentMemberLink,
  findFormalMemberForIdentity,
} from "../../../../lib/student-entry-access";

const verifySchema = z.object({ token: z.string().min(32).max(200) });

async function releaseClaim(registrationId: string) {
  await createSupabaseAdminClient()
    .from("student_checkin_email_verifications")
    .update({ status: "pending", verified_at: null, updated_at: new Date().toISOString() })
    .eq("id", registrationId)
    .eq("status", "verifying");
}

async function completeVerification(row: StudentEmailVerificationRow) {
  const admin = createSupabaseAdminClient();
  let profile = await loadStudentProfileById(row.profile_id);
  const formalMemberMatch = await findFormalMemberForIdentity({
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    birthDate: row.birth_date,
  });

  if (!profile) {
    if (row.auth_user_id) {
      const authUpdate = await admin.auth.admin.updateUserById(row.auth_user_id, {
        email_confirm: true,
        app_metadata: { account_type: "student_checkin", registration_id: row.id, entry_mode: row.entry_mode },
      });
      if (authUpdate.error) throw new Error("Email 驗證失敗，請稍後再試。");
    }

    const inserted = await admin
      .from("student_line_profiles")
      .insert({
        id: row.profile_id,
        auth_user_id: row.auth_user_id,
        line_user_id: null,
        line_display_name: null,
        full_name: row.full_name,
        phone: row.phone,
        email: row.email,
        birth_date: row.birth_date,
        password_hash: row.password_hash,
        autonomous_checkin_enabled: row.entry_mode === "autonomous" && Boolean(formalMemberMatch),
        is_active: true,
        email_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (inserted.error && inserted.error.code !== "23505") {
      throw new Error("建立學員資料失敗，請稍後再試。");
    }
    profile = await loadStudentProfileById(row.profile_id);
    if (!profile) {
      throw new Error(
        inserted.error?.code === "23505"
          ? "手機號碼或 Email 已由其他學員資料使用，請洽現場人員。"
          : "建立學員資料失敗，請稍後再試。",
      );
    }
  }

  if (formalMemberMatch) {
    const linked = await ensureStudentMemberLink(row.profile_id, formalMemberMatch);
    if (!linked && profile.autonomous_checkin_enabled) {
      await admin
        .from("student_line_profiles")
        .update({ autonomous_checkin_enabled: false, updated_at: new Date().toISOString() })
        .eq("id", row.profile_id);
    }
  }

  await ensureStudentDropInEntitlement(row.profile_id);
  const completedAt = new Date().toISOString();
  const completed = await admin
    .from("student_checkin_email_verifications")
    .update({
      status: "completed",
      verified_at: row.verified_at || completedAt,
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", row.id)
    .in("status", ["verifying", "completed"]);
  if (completed.error) throw new Error("完成驗證狀態更新失敗，請重新開啟驗證連結。");

  const response = NextResponse.json({
    ok: true,
    verified: true,
    authenticated: true,
    profile: { id: row.profile_id, fullName: row.full_name },
    entryMode: row.entry_mode,
  });
  setStudentAuthSession(response, row.profile_id, "phone");
  clearPendingStudentRegistrationCookie(response);
  return response;
}

export async function POST(request: Request) {
  const facility = await isBigeFacilityClosed({});
  if (facility.closed) {
    return NextResponse.json(
      { ok: false, code: "facility_closed", error: bigeFacilityClosedMessage(facility.setting) },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "驗證連結格式不正確。" }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const tokenHash = hashStudentEmailVerificationToken(parsed.data.token);
  const limit = rateLimitFixedWindow({
    key: `student-checkin-email-verify:${ip}:${tokenHash.slice(0, 16)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "驗證次數過多，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await admin
    .from("student_checkin_email_verifications")
    .update({ status: "pending", verified_at: null, updated_at: now })
    .eq("verification_token_hash", tokenHash)
    .eq("status", "verifying")
    .lt("updated_at", staleCutoff);

  const claim = await admin
    .from("student_checkin_email_verifications")
    .update({ status: "verifying", verified_at: now, updated_at: now })
    .eq("verification_token_hash", tokenHash)
    .eq("status", "pending")
    .gt("expires_at", now)
    .select(studentEmailVerificationSelect)
    .maybeSingle();
  if (claim.error) {
    return NextResponse.json({ ok: false, error: "驗證服務暫時無法使用，請稍後再試。" }, { status: 500 });
  }

  let row = (claim.data || null) as StudentEmailVerificationRow | null;
  if (!row) {
    const existing = await admin
      .from("student_checkin_email_verifications")
      .select(studentEmailVerificationSelect)
      .eq("verification_token_hash", tokenHash)
      .maybeSingle();
    if (existing.error || !existing.data) {
      return NextResponse.json({ ok: false, error: "驗證連結無效或已失效。" }, { status: 400 });
    }
    row = existing.data as StudentEmailVerificationRow;
    if (row.status === "completed") {
      try {
        return await completeVerification(row);
      } catch (error) {
        return NextResponse.json(
          { ok: false, error: error instanceof Error ? error.message : "無法載入報到狀態。" },
          { status: 500 },
        );
      }
    }
    if (row.status === "verifying") {
      return NextResponse.json({ ok: false, error: "驗證正在處理中，請稍候再重新整理。" }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: row.expires_at <= now ? "驗證連結已過期，請回到報到頁重新寄送。" : "驗證連結已失效。" },
      { status: 400 },
    );
  }

  try {
    return await completeVerification(row);
  } catch (error) {
    await releaseClaim(row.id).catch(() => null);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "驗證與報到失敗，請稍後再試。" },
      { status: 500 },
    );
  }
}
