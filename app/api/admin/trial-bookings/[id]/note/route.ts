import { NextResponse } from "next/server";
import { requireTrialBookingAdmin } from "../../../../../../lib/trial-booking-admin-auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";
import {
  parseTrialBookingStaffNote,
  trialBookingStaffNoteUpdateMatch,
} from "../../../../../../lib/trial-booking-staff-note";

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

  const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
  const parsedNote = parseTrialBookingStaffNote(body?.note);
  if (!parsedNote.ok) {
    return NextResponse.json({ ok: false, error: parsedNote.error }, { status: 400 });
  }

  try {
    const updatedAt = new Date().toISOString();
    const result = await createSupabaseAdminClient()
      .from("trial_bookings")
      .update({
        staff_note: parsedNote.note,
        staff_note_updated_at: updatedAt,
        staff_note_updated_by: auth.context.userId,
        updated_at: updatedAt,
      })
      .match(trialBookingStaffNoteUpdateMatch(bookingId))
      .select("id, staff_note, staff_note_updated_at, staff_note_updated_by, updated_at")
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
      { ok: false, error: error instanceof Error ? error.message : "Failed to update booking note" },
      { status: 500 },
    );
  }
}
