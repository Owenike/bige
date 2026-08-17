import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import { ensureStudentDropInEntitlement } from "../../../../../lib/student-drop-in";
import {
  loadStudentProfileById,
  setStudentAuthSession,
} from "../../../../../lib/student-checkin";
import {
  hashStudentSecuritySetupToken,
  studentSecuritySetupSelect,
  type StudentSecuritySetupRow,
} from "../../../../../lib/student-checkin-security-setup";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const verifySchema = z.object({ token: z.string().min(32).max(200) });

async function releaseClaim(setupId: string) {
  await createSupabaseAdminClient()
    .from("student_checkin_security_setups")
    .update({ status: "pending", verified_at: null, updated_at: new Date().toISOString() })
    .eq("id", setupId)
    .eq("status", "verifying");
}

async function completeSecuritySetup(row: StudentSecuritySetupRow) {
  const admin = createSupabaseAdminClient();
  let profile = await loadStudentProfileById(row.profile_id);
  if (!profile || profile.auth_user_id !== row.auth_user_id) {
    throw new Error("帳號資料不存在，請洽現場人員重新設定。");
  }

  const alreadyApplied = !profile.must_complete_security_setup && profile.email?.trim().toLowerCase() === row.pending_email.trim().toLowerCase();
  const completedAt = new Date().toISOString();

  if (!alreadyApplied) {
    if (!profile.must_complete_security_setup || !row.pending_password_hash) {
      throw new Error("安全設定資料不完整，請使用暫時密碼重新登入設定。");
    }

    const authUpdate = await admin.auth.admin.updateUserById(row.auth_user_id, {
      email: row.pending_email,
      email_confirm: true,
    });
    if (authUpdate.error) {
      const duplicate = authUpdate.error.message.toLowerCase().includes("already") || authUpdate.error.status === 422;
      throw new Error(duplicate ? "這個 Email 已由其他系統帳號使用，請返回修改 Email。" : "Email 驗證失敗，請稍後再試。");
    }

    const profileUpdate = await admin
      .from("student_line_profiles")
      .update({
        email: row.pending_email,
        password_hash: row.pending_password_hash,
        must_complete_security_setup: false,
        email_verified_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", row.profile_id)
      .eq("must_complete_security_setup", true);
    if (profileUpdate.error) {
      throw new Error(profileUpdate.error.code === "23505" ? "這個 Email 已由其他自主運動帳號使用，請返回修改 Email。" : "正式帳號資料更新失敗，請稍後再試。");
    }
    profile = await loadStudentProfileById(row.profile_id);
    if (!profile || profile.must_complete_security_setup) {
      throw new Error("正式帳號資料尚未完成更新，請重新開啟驗證連結。");
    }
  }

  const completed = await admin
    .from("student_checkin_security_setups")
    .update({
      status: "completed",
      pending_password_hash: null,
      verified_at: row.verified_at || completedAt,
      completed_at: row.completed_at || completedAt,
      updated_at: completedAt,
    })
    .eq("id", row.id)
    .in("status", ["verifying", "completed"]);
  if (completed.error) throw new Error("驗證完成狀態更新失敗，請重新開啟驗證連結。");

  await ensureStudentDropInEntitlement(row.profile_id);
  const response = NextResponse.json({
    ok: true,
    verified: true,
    authenticated: true,
    profile: { id: row.profile_id, fullName: profile.full_name },
  });
  setStudentAuthSession(response, row.profile_id, "phone");
  return response;
}

export async function POST(request: Request) {
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "驗證連結格式不正確。" }, { status: 400 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const tokenHash = hashStudentSecuritySetupToken(parsed.data.token);
  const limit = rateLimitFixedWindow({
    key: `student-checkin-security-setup-verify:${ip}:${tokenHash.slice(0, 16)}`,
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
    .from("student_checkin_security_setups")
    .update({ status: "pending", verified_at: null, updated_at: now })
    .eq("verification_token_hash", tokenHash)
    .eq("status", "verifying")
    .lt("updated_at", staleCutoff);

  const claim = await admin
    .from("student_checkin_security_setups")
    .update({ status: "verifying", verified_at: now, updated_at: now })
    .eq("verification_token_hash", tokenHash)
    .eq("status", "pending")
    .gt("expires_at", now)
    .select(studentSecuritySetupSelect)
    .maybeSingle();
  if (claim.error) return NextResponse.json({ ok: false, error: "驗證服務暫時無法使用，請稍後再試。" }, { status: 500 });

  let row = (claim.data || null) as StudentSecuritySetupRow | null;
  if (!row) {
    const existing = await admin
      .from("student_checkin_security_setups")
      .select(studentSecuritySetupSelect)
      .eq("verification_token_hash", tokenHash)
      .maybeSingle();
    if (existing.error || !existing.data) {
      return NextResponse.json({ ok: false, error: "驗證連結無效或已失效。" }, { status: 400 });
    }
    row = existing.data as StudentSecuritySetupRow;
    if (row.status === "completed") {
      try {
        return await completeSecuritySetup(row);
      } catch (error) {
        return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "無法載入報到狀態。" }, { status: 500 });
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
    return await completeSecuritySetup(row);
  } catch (error) {
    await releaseClaim(row.id).catch(() => null);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "安全設定驗證失敗，請稍後再試。" }, { status: 500 });
  }
}
