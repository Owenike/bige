import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient(request);
  await supabase.auth.signOut();
  return new NextResponse(null, { status: 204 });
}

