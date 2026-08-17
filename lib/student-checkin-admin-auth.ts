import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase/server";
import { hasAuthCapability } from "./auth-capabilities";

export type StudentCheckinAdminContext = {
  userId: string;
  role: string;
  tenantId: string | null;
  branchId: string | null;
};

export function studentCheckinAdminAuthFailure(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function requireStudentCheckinAdmin(request: Request) {
  let supabase;
  let user;
  try {
    const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
    const bearerToken = authorization ? /^Bearer\s+(.+)$/i.exec(authorization.trim())?.[1] : "";
    if (bearerToken) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error("Missing Supabase environment variables");
      supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const authResult = await supabase.auth.getUser(bearerToken);
      user = authResult.data.user;
      if (authResult.error || !user) {
        return { ok: false as const, response: studentCheckinAdminAuthFailure(401) };
      }
    } else {
      supabase = await createSupabaseServerClient(request);
      const authResult = await supabase.auth.getUser();
      user = authResult.data.user;
      if (authResult.error || !user) {
        return { ok: false as const, response: studentCheckinAdminAuthFailure(401) };
      }
    }
  } catch (error) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "Unable to verify access" },
        { status: 500 },
      ),
    };
  }

  if (!hasAuthCapability(user.app_metadata, "student_checkin_admin")) {
    return { ok: false as const, response: studentCheckinAdminAuthFailure(403) };
  }

  return {
    ok: true as const,
    supabase,
    context: {
      userId: user.id,
      role: "student_checkin_admin",
      tenantId: null,
      branchId: null,
    } satisfies StudentCheckinAdminContext,
  };
}
