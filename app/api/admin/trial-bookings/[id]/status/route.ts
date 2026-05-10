import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

const bookingStatuses = new Set(["new", "contacted", "scheduled", "completed", "cancelled"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const { id } = await context.params;
  const bookingId = typeof id === "string" ? id.trim() : "";
  if (!bookingId || !uuidPattern.test(bookingId)) {
    return NextResponse.json({ ok: false, error: "Invalid booking id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { bookingStatus?: unknown } | null;
  if (!body || !Object.prototype.hasOwnProperty.call(body, "bookingStatus")) {
    return NextResponse.json({ ok: false, error: "bookingStatus is required" }, { status: 400 });
  }

  const bookingStatus = typeof body.bookingStatus === "string" ? body.bookingStatus.trim() : "";
  if (!bookingStatuses.has(bookingStatus)) {
    return NextResponse.json({ ok: false, error: "Invalid bookingStatus" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const result = await admin
      .from("trial_bookings")
      .update({
        booking_status: bookingStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId)
      .select("id, booking_status, updated_at")
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
    }

    if (!result.data) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, booking: result.data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update booking status" },
      { status: 500 },
    );
  }
}
