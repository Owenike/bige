import { createClient } from "@supabase/supabase-js";
import type { ProfileContext } from "./auth-context";
import { normalizeStaffDepartment, normalizeStaffPosition } from "./staff-organization";
import { createSupabaseAdminClient } from "./supabase/admin";

export type SensitiveCredentials = {
  account?: string;
  password?: string;
  reason?: string;
};

export type SensitiveOperator = {
  userId: string;
  role: ProfileContext["role"];
  department: NonNullable<ProfileContext["department"]> | null;
  position: NonNullable<ProfileContext["position"]> | null;
  tenantId: string | null;
  branchId: string | null;
};

export async function verifySensitiveOperator(params: {
  session: Pick<ProfileContext, "userId" | "role" | "tenantId" | "branchId"> &
    Partial<Pick<ProfileContext, "department" | "position">>;
  credentials: SensitiveCredentials | null | undefined;
}) {
  const account = params.credentials?.account?.trim().toLowerCase() || "";
  const password = params.credentials?.password || "";
  const reason = params.credentials?.reason?.trim() || "";
  if (!account || !password || !reason) {
    return {
      ok: false as const,
      code: "SENSITIVE_REAUTH_REQUIRED",
      message: "此操作需要重新輸入員工 Email、密碼與操作原因",
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) {
    return {
      ok: false as const,
      code: "INTERNAL_ERROR",
      message: "登入驗證服務尚未設定",
    };
  }

  const isolated = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const signedIn = await isolated.auth.signInWithPassword({ email: account, password });
  if (signedIn.error || !signedIn.data.user) {
    return {
      ok: false as const,
      code: "SENSITIVE_REAUTH_FAILED",
      message: "員工帳號或密碼不正確",
    };
  }

  const admin = createSupabaseAdminClient();
  const profile = await admin
    .from("profiles")
    .select("id, role, department, position, tenant_id, branch_id, is_active")
    .eq("id", signedIn.data.user.id)
    .maybeSingle();

  if (
    profile.error ||
    !profile.data ||
    profile.data.is_active !== true ||
    !signedIn.data.session?.access_token
  ) {
    return {
      ok: false as const,
      code: "SENSITIVE_REAUTH_FAILED",
      message: "找不到可用的員工帳號",
    };
  }
  if (
    profile.data.role !== "platform_admin" &&
    profile.data.tenant_id !== params.session.tenantId
  ) {
    return {
      ok: false as const,
      code: "SENSITIVE_REAUTH_FAILED",
      message: "此員工不屬於目前分店組織",
    };
  }

  const operator: SensitiveOperator = {
    userId: profile.data.id,
    role: profile.data.role as ProfileContext["role"],
    department: normalizeStaffDepartment(profile.data.department),
    position: normalizeStaffPosition(profile.data.position),
    tenantId: profile.data.tenant_id,
    branchId: profile.data.branch_id,
  };
  return {
    ok: true as const,
    operator,
    reason,
    accessToken: signedIn.data.session.access_token,
  };
}
