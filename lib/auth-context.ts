import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "./supabase/server";
import { createClient } from "@supabase/supabase-js";

export type AppRole = "platform_admin" | "manager" | "frontdesk" | "coach" | "member";

export interface ProfileContext {
  userId: string;
  role: AppRole;
  tenantId: string | null;
  branchId: string | null;
}

interface ProfileRow {
  id: string;
  role: AppRole;
  tenant_id: string | null;
  branch_id: string | null;
  is_active: boolean;
}

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function readBearerToken(request?: Request) {
  if (!request) return null;
  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] || null;
}

export async function requireProfile(allowedRoles?: AppRole[], request?: Request) {
  let supabase;
  try {
    supabase = await createSupabaseServerClient(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supabase client initialization failed";
    return { ok: false as const, response: jsonError(500, message) };
  }

  const bearerToken = readBearerToken(request);
  const authResult = bearerToken
    ? await createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        { auth: { persistSession: false, autoRefreshToken: false } },
      ).auth.getUser(bearerToken)
    : await supabase.auth.getUser();
  const user = authResult.data.user;

  if (authResult.error || !user) {
    return { ok: false as const, response: jsonError(401, "Unauthorized") };
  }

  const profileResult = await supabase
    .from("profiles")
    .select("id, role, tenant_id, branch_id, is_active")
    .eq("id", user.id)
    .maybeSingle();

  const profile = (profileResult.data as ProfileRow | null) ?? null;

  if (profileResult.error) {
    return { ok: false as const, response: jsonError(500, profileResult.error.message) };
  }

  if (!profile || !profile.is_active) {
    return { ok: false as const, response: jsonError(403, "Profile not found or inactive") };
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return { ok: false as const, response: jsonError(403, "Forbidden") };
  }

  const context: ProfileContext = {
    userId: profile.id,
    role: profile.role,
    tenantId: profile.tenant_id,
    branchId: profile.branch_id,
  };

  return { ok: true as const, context, supabase };
}
