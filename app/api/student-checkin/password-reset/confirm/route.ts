import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import { hashStudentPassword } from "../../../../../lib/student-checkin";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const schema = z.object({ password: z.string().min(6).max(100) });

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimitFixedWindow({ key: `student-password-reset:${ip}`, limit: 8, windowMs: 60 * 60 * 1000 });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "重設次數過多，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec), "Cache-Control": "no-store" } },
    );
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!token || !parsed.success) {
    return NextResponse.json({ ok: false, error: "重設連結或新密碼不正確。" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const admin = createSupabaseAdminClient();
  const verified = await admin.auth.getUser(token);
  if (verified.error || !verified.data.user) {
    return NextResponse.json({ ok: false, error: "重設連結已失效，請重新寄送。" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const profileByAuth = await admin
    .from("student_line_profiles")
    .select("id, auth_user_id, password_hash")
    .eq("auth_user_id", verified.data.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (profileByAuth.error) {
    return NextResponse.json({ ok: false, error: "目前無法確認學員資料，請稍後再試。" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  let profile = profileByAuth.data;
  if (!profile) {
    const verifiedEmail = verified.data.user.email?.trim().toLowerCase();
    if (verifiedEmail) {
      const profileByEmail = await admin
        .from("student_line_profiles")
        .select("id, auth_user_id, password_hash")
        .eq("email", verifiedEmail)
        .is("auth_user_id", null)
        .eq("is_active", true)
        .maybeSingle();
      if (profileByEmail.error) {
        return NextResponse.json({ ok: false, error: "目前無法確認學員資料，請稍後再試。" }, { status: 500, headers: { "Cache-Control": "no-store" } });
      }
      profile = profileByEmail.data;
    }
  }

  if (!profile) {
    return NextResponse.json({ ok: false, error: "找不到可重設的學員資料，請洽現場人員。" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const passwordHash = await hashStudentPassword(parsed.data.password);
  const updatedProfile = await admin
    .from("student_line_profiles")
    .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
    .eq("id", profile.id);
  if (updatedProfile.error) {
    return NextResponse.json({ ok: false, error: "密碼更新失敗，請稍後再試。" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  if (profile.auth_user_id === verified.data.user.id) {
    const updatedAuth = await admin.auth.admin.updateUserById(verified.data.user.id, { password: parsed.data.password });
    if (updatedAuth.error) {
      await admin.from("student_line_profiles").update({ password_hash: profile.password_hash }).eq("id", profile.id);
      return NextResponse.json({ ok: false, error: "密碼更新失敗，請稍後再試。" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
