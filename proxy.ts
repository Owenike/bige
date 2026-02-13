import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const REQUEST_ID_HEADER = "x-request-id";

const ROLE_PATHS: Array<{
  prefix: string;
  allow: Array<"platform_admin" | "manager" | "frontdesk" | "coach" | "member">;
}> = [
  { prefix: "/platform-admin", allow: ["platform_admin"] },
  { prefix: "/manager", allow: ["manager"] },
  { prefix: "/frontdesk", allow: ["frontdesk", "manager"] },
  { prefix: "/coach", allow: ["coach"] },
  { prefix: "/member", allow: ["member"] },
];

function isProtectedPath(pathname: string) {
  return ROLE_PATHS.some((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`));
}

function matchRule(pathname: string) {
  return ROLE_PATHS.find((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) || null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always attach/propagate a request id so API routes can correlate logs.
  const requestId = request.headers.get(REQUEST_ID_HEADER) || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);

  // Only enforce role-based gating for page routes; APIs do their own auth.
  if (!isProtectedPath(pathname)) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) {
    const misconfiguredUrl = request.nextUrl.clone();
    misconfiguredUrl.pathname = "/forbidden";
    misconfiguredUrl.search = "";
    const redirect = NextResponse.redirect(misconfiguredUrl);
    redirect.headers.set(REQUEST_ID_HEADER, requestId);
    return redirect;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options as any);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", pathname);
    const redirect = NextResponse.redirect(loginUrl);
    redirect.headers.set(REQUEST_ID_HEADER, requestId);
    return redirect;
  }

  const rule = matchRule(pathname);
  if (!rule) return response;

  const profileResult = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  const profile = (profileResult.data as { role: string; is_active: boolean } | null) ?? null;
  if (!profileResult.error && profile && profile.is_active && rule.allow.includes(profile.role as any)) {
    return response;
  }

  const forbiddenUrl = request.nextUrl.clone();
  forbiddenUrl.pathname = "/forbidden";
  forbiddenUrl.search = "";
  const redirect = NextResponse.redirect(forbiddenUrl);
  redirect.headers.set(REQUEST_ID_HEADER, requestId);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

