import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "../../../../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/admin";

const schema = z.object({
  expiresOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]),
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
  if (!parsed.success || (parsed.data.expiresOn && parsed.data.expiresOn < "1900-01-01")) {
    return NextResponse.json({ ok: false, error: "期限日期格式不正確。" }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await createSupabaseAdminClient()
    .from("student_line_profiles")
    .update({ membership_expires_on: parsed.data.expiresOn, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("is_active", true)
    .select("id, membership_expires_on")
    .maybeSingle();

  if (result.error) return NextResponse.json({ ok: false, error: "期限更新失敗，請稍後再試。" }, { status: 500 });
  if (!result.data) return NextResponse.json({ ok: false, error: "找不到這位學員。" }, { status: 404 });
  return NextResponse.json({ ok: true, expiresOn: result.data.membership_expires_on });
}
