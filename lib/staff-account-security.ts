import { createClient } from "@supabase/supabase-js";

export async function verifyStaffCurrentPassword(email: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) {
    return { ok: false as const, error: "帳號驗證服務尚未設定" };
  }

  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.user) {
    return { ok: false as const, error: "目前密碼不正確" };
  }

  await client.auth.signOut().catch(() => null);
  return { ok: true as const };
}
