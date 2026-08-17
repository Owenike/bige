import { NextResponse } from "next/server";
import { requireTrialBookingAdmin } from "../../../../../../lib/trial-booking-admin-auth";
import { normalizeTrialBookingContactNote } from "../../../../../../lib/trial-booking-contact";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

const bookingStatuses = new Set(["new", "contacted", "scheduled", "completed", "cancelled", "no_show"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTrialBookingAdmin(request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const { id } = await context.params;
  const bookingId = typeof id === "string" ? id.trim() : "";
  if (!bookingId || !uuidPattern.test(bookingId)) {
    return NextResponse.json({ ok: false, error: "Invalid booking id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    bookingStatus?: unknown;
    contactNote?: unknown;
  } | null;
  if (!body || !Object.prototype.hasOwnProperty.call(body, "bookingStatus")) {
    return NextResponse.json({ ok: false, error: "bookingStatus is required" }, { status: 400 });
  }

  const bookingStatus = typeof body.bookingStatus === "string" ? body.bookingStatus.trim() : "";
  if (!bookingStatuses.has(bookingStatus)) {
    return NextResponse.json({ ok: false, error: "Invalid bookingStatus" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();

    if (bookingStatus === "contacted") {
      const contactNote = normalizeTrialBookingContactNote(body.contactNote);
      if (!contactNote) {
        return NextResponse.json(
          { ok: false, error: "請填寫聯繫備註（最多 500 字）。" },
          { status: 400 },
        );
      }

      if (!auth.context.tenantId) {
        return NextResponse.json({ ok: false, error: "Missing tenant context" }, { status: 400 });
      }

      const contactResult = await admin.rpc("record_trial_booking_contact", {
        p_booking_id: bookingId,
        p_tenant_id: auth.context.tenantId,
        p_contacted_by: auth.context.userId,
        p_note: contactNote,
      });

      if (contactResult.error) {
        const status = contactResult.error.message.includes("booking_not_found") ? 404 : 500;
        return NextResponse.json({ ok: false, error: contactResult.error.message }, { status });
      }

      return NextResponse.json({ ok: true, booking: contactResult.data });
    }

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
