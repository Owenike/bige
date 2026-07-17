import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "../../../../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/admin";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  startsOn: dateSchema,
  expiresOn: dateSchema,
});

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (
    !parsed.success
    || parsed.data.startsOn < "1900-01-01"
    || parsed.data.expiresOn < parsed.data.startsOn
  ) {
    return NextResponse.json({ ok: false, error: "請輸入正確的開始日期與結束日期。" }, { status: 400 });
  }

  const { id } = await context.params;
  const admin = createSupabaseAdminClient();
  const current = await admin
    .from("student_line_profiles")
    .select("id, membership_starts_on, membership_expires_on")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (current.error) return NextResponse.json({ ok: false, error: "期限資料讀取失敗，請稍後再試。" }, { status: 500 });
  if (!current.data) return NextResponse.json({ ok: false, error: "找不到這位學員。" }, { status: 404 });
  if (current.data.membership_starts_on || current.data.membership_expires_on) {
    return NextResponse.json({ ok: false, error: "自主運動期限已儲存並鎖定，無法再次更改。" }, { status: 409 });
  }

  const result = await admin
    .from("student_line_profiles")
    .update({
      membership_starts_on: parsed.data.startsOn,
      membership_expires_on: parsed.data.expiresOn,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("is_active", true)
    .is("membership_starts_on", null)
    .is("membership_expires_on", null)
    .select("id, membership_starts_on, membership_expires_on")
    .maybeSingle();

  if (result.error) return NextResponse.json({ ok: false, error: "期限儲存失敗，請稍後再試。" }, { status: 500 });
  if (!result.data) {
    return NextResponse.json({ ok: false, error: "自主運動期限已被設定，無法再次更改。" }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    startsOn: result.data.membership_starts_on,
    expiresOn: result.data.membership_expires_on,
    locked: true,
  });
}
