import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;
  const userId = auth.context.userId;

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, tenant_id, store_id, full_name, phone, photo_url, notes, consent_status, consent_signed_at")
    .eq("auth_user_id", userId)
    .maybeSingle();

  // If consent columns aren't migrated yet, fallback to the older column set.
  let finalMember = member as
    | (typeof member & { notes?: string | null; consent_status?: string; consent_signed_at?: string | null })
    | null;
  let finalError = memberError;
  if (finalError && finalError.message.includes("consent_")) {
    const fallback = await supabase
      .from("members")
      .select("id, tenant_id, store_id, full_name, phone, photo_url, notes")
      .eq("auth_user_id", userId)
      .maybeSingle();
    finalMember = (fallback.data as typeof finalMember) ?? null;
    finalError = fallback.error;
  }

  if (finalError || !finalMember) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  const [subscriptionResult, passResult, checkinResult] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("id, valid_from, valid_to, status")
      .eq("tenant_id", String(member.tenant_id))
      .eq("member_id", String(member.id))
      .eq("status", "active")
      .lte("valid_from", now)
      .gte("valid_to", now)
      .order("valid_to", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("entry_passes")
      .select("id, pass_type, remaining, expires_at, status")
      .eq("tenant_id", String(member.tenant_id))
      .eq("member_id", String(member.id))
      .eq("status", "active")
      .or(`expires_at.is.null,expires_at.gte.${now}`)
      .order("expires_at", { ascending: true }),
    supabase
      .from("checkins")
      .select("id, checked_at, result, reason")
      .eq("tenant_id", String(member.tenant_id))
      .eq("member_id", String(member.id))
      .order("checked_at", { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    member: finalMember,
    activeSubscription: subscriptionResult.data ?? null,
    activePasses: passResult.data ?? [],
    checkins: checkinResult.data ?? [],
  });
}
