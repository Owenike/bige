import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseAdminClient } from "./lib/supabase/admin";
import { evaluateTenantAccess, type TenantStatus, type TenantSubscriptionSnapshot } from "./lib/tenant-subscription";

const REQUEST_ID_HEADER = "x-request-id";

type RouteScope = "platform_admin" | "manager" | "frontdesk" | "member" | null;

type SessionContext = {
  userId: string;
  role: string | null;
  isActive: boolean;
  tenantId: string | null;
  branchId: string | null;
  tenantStatus: TenantStatus;
  subscription: TenantSubscriptionSnapshot | null;
};

function normalizePathScope(pathname: string): RouteScope {
  if (pathname === "/platform-admin" || pathname.startsWith("/platform-admin/")) return "platform_admin";
  if (pathname === "/manager" || pathname.startsWith("/manager/")) return "manager";
  if (pathname === "/frontdesk" || pathname.startsWith("/frontdesk/")) return "frontdesk";
  if (pathname === "/member" || pathname.startsWith("/member/")) return "member";
  return null;
}

function isRouteAllowed(scope: RouteScope, role: string) {
  const roleSet = new Set([role]);
  if (scope === "platform_admin") return roleSet.has("platform_admin");
  if (scope === "manager") {
    return (
      roleSet.has("platform_admin") ||
      roleSet.has("manager") ||
      roleSet.has("supervisor") ||
      roleSet.has("branch_manager")
    );
  }
  if (scope === "frontdesk") {
    return (
      roleSet.has("platform_admin") ||
      roleSet.has("manager") ||
      roleSet.has("supervisor") ||
      roleSet.has("branch_manager") ||
      roleSet.has("frontdesk")
    );
  }
  if (scope === "member") return roleSet.has("member") || roleSet.has("platform_admin");
  return true;
}

function isSalesManagerAllowedPath(pathname: string) {
  return (
    pathname === "/manager/crm" ||
    pathname.startsWith("/manager/crm/") ||
    pathname === "/manager/opportunities" ||
    pathname.startsWith("/manager/opportunities/")
  );
}

function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

function redirectToLogin(request: NextRequest, requestId: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("redirect", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return withRequestId(NextResponse.redirect(url), requestId);
}

function redirectBlocked(request: NextRequest, requestId: string, code: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/forbidden";
  url.searchParams.set("code", code);
  return withRequestId(NextResponse.redirect(url), requestId);
}

async function loadSessionContext(request: NextRequest, response: NextResponse): Promise<SessionContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const cookie of cookiesToSet) {
          const options = cookie.options as Parameters<typeof response.cookies.set>[2];
          response.cookies.set(cookie.name, cookie.value, options);
        }
      },
    },
  });

  const authResult = await supabase.auth.getUser();
  const user = authResult.data.user;
  if (authResult.error || !user) return null;

  const profileResult = await supabase
    .from("profiles")
    .select("id, role, is_active, tenant_id, branch_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileResult.error || !profileResult.data) {
    return {
      userId: user.id,
      role: null,
      isActive: false,
      tenantId: null,
      branchId: null,
      tenantStatus: null,
      subscription: null,
    };
  }

  const profile = profileResult.data as {
    id: string;
    role: string | null;
    is_active: boolean;
    tenant_id: string | null;
    branch_id: string | null;
  };

  let tenantStatus: TenantStatus = null;
  let subscription: TenantSubscriptionSnapshot | null = null;
  if (profile.tenant_id) {
    try {
      const admin = createSupabaseAdminClient();
      const [tenantResult, subscriptionResult] = await Promise.all([
        admin.from("tenants").select("status").eq("id", profile.tenant_id).maybeSingle(),
        admin
          .from("tenant_subscriptions")
          .select("status, starts_at, ends_at, grace_ends_at, plan_code, saas_plans(name)")
          .eq("tenant_id", profile.tenant_id)
          .eq("is_current", true)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!tenantResult.error) {
        tenantStatus = (tenantResult.data?.status as TenantStatus) ?? null;
      }
      if (!subscriptionResult.error) {
        const row = (subscriptionResult.data as {
          status: TenantSubscriptionSnapshot["status"];
          starts_at: string | null;
          ends_at: string | null;
          grace_ends_at: string | null;
          plan_code: string | null;
          saas_plans: { name: string | null } | Array<{ name: string | null }> | null;
        } | null) ?? null;
        const planInfo = Array.isArray(row?.saas_plans) ? row?.saas_plans[0] : row?.saas_plans;
        if (row) {
          subscription = {
            status: row.status ?? null,
            startsAt: row.starts_at ?? null,
            endsAt: row.ends_at ?? null,
            graceEndsAt: row.grace_ends_at ?? null,
            planCode: row.plan_code ?? null,
            planName: planInfo?.name ?? null,
          };
        }
      }
    } catch {
      tenantStatus = null;
      subscription = null;
    }
  }

  return {
    userId: profile.id,
    role: profile.role,
    isActive: profile.is_active === true,
    tenantId: profile.tenant_id,
    branchId: profile.branch_id,
    tenantStatus,
    subscription,
  };
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const scope = normalizePathScope(request.nextUrl.pathname);
  if (!scope) return withRequestId(response, requestId);

  const session = await loadSessionContext(request, response);
  if (!session) {
    return redirectToLogin(request, requestId);
  }

  if (!session.role) {
    return redirectBlocked(request, requestId, "FORBIDDEN");
  }

  if (!session.isActive) {
    return redirectBlocked(request, requestId, "INACTIVE_ACCOUNT");
  }

  if (!isRouteAllowed(scope, session.role)) {
    if (scope === "member") {
      return redirectToLogin(request, requestId);
    }
    if (scope === "manager" && session.role === "sales" && isSalesManagerAllowedPath(request.nextUrl.pathname)) {
      return withRequestId(response, requestId);
    }
    return redirectBlocked(request, requestId, "FORBIDDEN");
  }

  if (scope === "frontdesk" && session.role === "frontdesk" && !session.branchId) {
    return redirectBlocked(request, requestId, "BRANCH_SCOPE_DENIED");
  }

  if (session.role !== "platform_admin") {
    const access = evaluateTenantAccess({
      tenantStatus: session.tenantStatus,
      subscription: session.subscription,
    });
    if (!access.allowed && access.blockedCode) {
      const allowManagerLanding =
        scope === "manager" &&
        (request.nextUrl.pathname === "/manager" || request.nextUrl.pathname === "/manager/");
      if (allowManagerLanding) {
        response.headers.set("x-tenant-blocked-code", access.blockedCode);
        return withRequestId(response, requestId);
      }
      return redirectBlocked(request, requestId, access.blockedCode);
    }
  }

  return withRequestId(response, requestId);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
