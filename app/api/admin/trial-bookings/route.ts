import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const paymentMethods = new Set(["cash_on_site", "online_payment"]);
const paymentStatuses = new Set(["pending_cash", "pending_payment", "paid", "failed", "cancelled"]);
const bookingStatuses = new Set(["new", "contacted", "scheduled", "completed", "cancelled"]);

const TRIAL_BOOKING_SELECT = [
  "id",
  "created_at",
  "name",
  "phone",
  "line_name",
  "service",
  "preferred_time",
  "payment_method",
  "payment_status",
  "booking_status",
  "note",
].join(", ");

function readEnumParam(searchParams: URLSearchParams, name: string, allowed: Set<string>) {
  const value = searchParams.get(name)?.trim();
  if (!value || !allowed.has(value)) return null;
  return value;
}

function escapeIlikeValue(value: string) {
  return value.replace(/[%_]/g, (match) => `\\${match}`).replace(/[(),]/g, " ");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const searchParams = url.searchParams;
    const paymentMethod = readEnumParam(searchParams, "paymentMethod", paymentMethods);
    const paymentStatus = readEnumParam(searchParams, "paymentStatus", paymentStatuses);
    const bookingStatus = readEnumParam(searchParams, "bookingStatus", bookingStatuses);
    const q = (searchParams.get("q") || "").trim().slice(0, 80);

    const admin = createSupabaseAdminClient();
    let query = admin
      .from("trial_bookings")
      .select(TRIAL_BOOKING_SELECT)
      .order("created_at", { ascending: false })
      .limit(100);

    if (paymentMethod) query = query.eq("payment_method", paymentMethod);
    if (paymentStatus) query = query.eq("payment_status", paymentStatus);
    if (bookingStatus) query = query.eq("booking_status", bookingStatus);
    if (q) {
      const escapedQ = escapeIlikeValue(q);
      query = query.or(`name.ilike.%${escapedQ}%,phone.ilike.%${escapedQ}%,line_name.ilike.%${escapedQ}%`);
    }

    const result = await query;

    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, bookings: result.data || [] });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load trial bookings" },
      { status: 500 },
    );
  }
}
