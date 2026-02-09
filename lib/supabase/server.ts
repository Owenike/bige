import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

type CookieValue = {
  name: string;
  value: string;
  options?: unknown;
};

function readSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return { url, anonKey };
}

function readBearerToken(request?: Request) {
  if (!request) return null;
  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] || null;
}

export async function createSupabaseServerClient(request?: Request) {
  const bearerToken = readBearerToken(request);
  const { url, anonKey } = readSupabaseEnv();

  if (bearerToken) {
    return createClient(url, anonKey, {
      accessToken: async () => bearerToken,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookieValues: CookieValue[]) {
        try {
          cookieValues.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options as any);
          });
        } catch {
          // No-op in environments where response cookies are immutable.
        }
      },
    },
  });
}
