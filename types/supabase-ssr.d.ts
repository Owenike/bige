declare module "@supabase/ssr" {
  export function createServerClient(
    supabaseUrl: string,
    supabaseKey: string,
    options: {
      cookieOptions?: {
        name?: string;
      };
      cookies: {
        getAll: () => Array<{ name: string; value: string }>;
        setAll: (cookies: Array<{ name: string; value: string; options?: unknown }>) => void;
      };
    },
  ): any;
}
