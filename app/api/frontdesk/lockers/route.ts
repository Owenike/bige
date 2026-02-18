import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseAmount(input: unknown) {
  const n = Number(input);
  return Number.isFinite(n) ? n : Number.NaN;
}

function normalizeLockerCode(input: unknown) {
  if (typeof input !== "string") return "";
  return input.trim().toUpperCase();
}

function parseIso(input: unknown) {
  if (typeof input !== "string" || !input.trim()) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function rowToItem(row: any) {
  return {
    id: String(row.id),
    lockerCode: String(row.locker_code || ""),
    memberId: row.member_id ? String(row.member_id) : null,
    renterName: row.renter_name ? String(row.renter_name) : "",
    phone: row.phone ? String(row.phone) : "",
    depositAmount: Number(row.deposit_amount ?? 0),
    note: row.note ? String(row.note) : "",
    status: String(row.status || "active"),
    rentedAt: row.rented_at,
    dueAt: row.due_at,
    returnedAt: row.returned_at,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }
  if (!auth.context.branchId) {
    return NextResponse.json({ error: "Missing branch context" }, { status: 400 });
  }

  const list = await auth.supabase
    .from("frontdesk_locker_rentals")
    .select("id, locker_code, member_id, renter_name, phone, deposit_amount, note, status, rented_at, due_at, returned_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .order("status", { ascending: true })
    .order("rented_at", { ascending: false })
    .limit(100);

  if (list.error) {
    if (list.error.message.includes('relation "frontdesk_locker_rentals" does not exist')) {
      return NextResponse.json({ error: "lockers table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: list.error.message }, { status: 500 });
  }

  return NextResponse.json({ items: (list.data || []).map(rowToItem) });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }
  if (!auth.context.branchId) {
    return NextResponse.json({ error: "Missing branch context" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action === "return" ? "return" : "rent";

  const openShift = await requireOpenShift({
    supabase: auth.supabase,
    context: auth.context,
    enforceRoles: ["frontdesk"],
  });
  if (!openShift.ok) return openShift.response;

  if (action === "return") {
    const rentalId = typeof body?.rentalId === "string" ? body.rentalId.trim() : "";
    if (!UUID_RE.test(rentalId)) {
      return NextResponse.json({ error: "Invalid rentalId" }, { status: 400 });
    }

    const updatedAt = new Date().toISOString();
    const updateResult = await auth.supabase
      .from("frontdesk_locker_rentals")
      .update({
        status: "returned",
        returned_at: updatedAt,
        returned_by: auth.context.userId,
        updated_at: updatedAt,
      })
      .eq("tenant_id", auth.context.tenantId)
      .eq("branch_id", auth.context.branchId)
      .eq("id", rentalId)
      .eq("status", "active")
      .select("id, locker_code, member_id, renter_name, phone, deposit_amount, note, status, rented_at, due_at, returned_at")
      .maybeSingle();

    if (updateResult.error) {
      if (updateResult.error.message.includes('relation "frontdesk_locker_rentals" does not exist')) {
        return NextResponse.json({ error: "lockers table missing. Apply migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
    }
    if (!updateResult.data) {
      return NextResponse.json({ error: "Rental not found or already returned" }, { status: 404 });
    }

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "locker_return",
      target_type: "locker_rental",
      target_id: rentalId,
      reason: "frontdesk_operation",
      payload: {
        lockerCode: updateResult.data.locker_code,
      },
    });

    return NextResponse.json({ item: rowToItem(updateResult.data) });
  }

  const lockerCode = normalizeLockerCode(body?.lockerCode);
  const memberId = typeof body?.memberId === "string" ? body.memberId.trim() : "";
  const renterName = typeof body?.renterName === "string" ? body.renterName.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const depositAmount = parseAmount(body?.depositAmount ?? 0);
  const dueAt = parseIso(body?.dueAt);
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (!lockerCode) {
    return NextResponse.json({ error: "lockerCode is required" }, { status: 400 });
  }
  if (lockerCode.length > 32) {
    return NextResponse.json({ error: "lockerCode too long" }, { status: 400 });
  }
  if (memberId && !UUID_RE.test(memberId)) {
    return NextResponse.json({ error: "Invalid memberId" }, { status: 400 });
  }
  if (!memberId && !renterName && !phone) {
    return NextResponse.json({ error: "memberId, renterName, or phone is required" }, { status: 400 });
  }
  if (!Number.isFinite(depositAmount) || depositAmount < 0) {
    return NextResponse.json({ error: "Invalid depositAmount" }, { status: 400 });
  }
  if (typeof body?.dueAt === "string" && body.dueAt.trim() && !dueAt) {
    return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
  }

  const existingActive = await auth.supabase
    .from("frontdesk_locker_rentals")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .eq("locker_code", lockerCode)
    .eq("status", "active")
    .maybeSingle();

  if (existingActive.error) {
    if (existingActive.error.message.includes('relation "frontdesk_locker_rentals" does not exist')) {
      return NextResponse.json({ error: "lockers table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: existingActive.error.message }, { status: 500 });
  }
  if (existingActive.data) {
    return NextResponse.json({ error: "Locker is already in use" }, { status: 409 });
  }

  const updatedAt = new Date().toISOString();
  const insertResult = await auth.supabase
    .from("frontdesk_locker_rentals")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      locker_code: lockerCode,
      member_id: memberId || null,
      renter_name: renterName || null,
      phone: phone || null,
      deposit_amount: depositAmount,
      note: note || null,
      status: "active",
      rented_by: auth.context.userId,
      due_at: dueAt,
      updated_at: updatedAt,
    })
    .select("id, locker_code, member_id, renter_name, phone, deposit_amount, note, status, rented_at, due_at, returned_at")
    .maybeSingle();

  if (insertResult.error) {
    if (insertResult.error.message.includes('relation "frontdesk_locker_rentals" does not exist')) {
      return NextResponse.json({ error: "lockers table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "locker_rent",
    target_type: "locker_rental",
    target_id: insertResult.data?.id ? String(insertResult.data.id) : null,
    reason: "frontdesk_operation",
    payload: {
      lockerCode,
      memberId: memberId || null,
      renterName: renterName || null,
      phone: phone || null,
      depositAmount,
      dueAt,
    },
  });

  return NextResponse.json({ item: rowToItem(insertResult.data) }, { status: 201 });
}
