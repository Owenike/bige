import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const schema = z.object({
  password: z.string().min(6).max(200),
});

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  return match?.[1] || "";
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "新密碼至少需要 6 碼。" }, { status: 400 });
  }

  const token = readBearerToken(request);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !key) {
    return NextResponse.json({ ok: false, error: "重設連結已失效，請重新寄送。" }, { status: 401 });
  }

  const verifier = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userResult = await verifier.auth.getUser(token);
  const user = userResult.data.user;
  if (userResult.error || !user) {
    return NextResponse.json({ ok: false, error: "重設連結已失效，請重新寄送。" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const updateResult = await admin.auth.admin.updateUserById(user.id, {
    password: parsed.data.password,
  });
  if (updateResult.error) {
    return NextResponse.json({ ok: false, error: "密碼更新失敗，請稍後再試。" }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
