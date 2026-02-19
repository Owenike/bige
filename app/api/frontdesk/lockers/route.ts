import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCKER_RENTAL_TERMS = ["daily", "monthly", "half_year", "yearly", "custom"] as const;
type LockerRentalTerm = (typeof LOCKER_RENTAL_TERMS)[number];
const MEMBER_CODE_RE = /^\d{1,4}$/;

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

function parseRentalTerm(input: unknown): LockerRentalTerm | null {
  if (typeof input !== "string") return "daily";
  const term = input.trim();
  if ((LOCKER_RENTAL_TERMS as readonly string[]).includes(term)) return term as LockerRentalTerm;
  return null;
}

function normalizeMemberCode(input: unknown) {
  if (typeof input !== "string") return "";
  return input.trim();
}

function addMonths(base: Date, months: number) {
  const date = new Date(base);
  const dayOfMonth = date.getDate();
  date.setMonth(date.getMonth() + months);
  if (date.getDate() < dayOfMonth) {
    date.setDate(0);
  }
  return date;
}

function calcDueAtByTerm(term: LockerRentalTerm) {
  const now = new Date();
  if (term === "daily") {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
  if (term === "monthly") return addMonths(now, 1).toISOString();
  if (term === "half_year") return addMonths(now, 6).toISOString();
  if (term === "yearly") return addMonths(now, 12).toISOString();
  return null;
}

function isLockerTableMissing(message: string) {
  return message.includes('relation "frontdesk_locker_rentals" does not exist')
    || message.includes("Could not find the table 'public.frontdesk_locker_rentals' in the schema cache")
    || message.includes('column frontdesk_locker_rentals.member_code does not exist')
    || message.includes('column frontdesk_locker_rentals.rental_term does not exist');
}

function rowToItem(row: any) {
  return {
    id: String(row.id),
    lockerCode: String(row.locker_code || ""),
    memberId: row.member_id ? String(row.member_id) : null,
    memberCode: row.member_code ? String(row.member_code) : "",
    renterName: row.renter_name ? String(row.renter_name) : "",
    phone: row.phone ? String(row.phone) : "",
    depositAmount: Number(row.deposit_amount ?? 0),
    note: row.note ? String(row.note) : "",
    status: String(row.status || "active"),
    rentalTerm: String(row.rental_term || "daily"),
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
    .select("id, locker_code, member_id, member_code, renter_name, phone, deposit_amount, note, status, rental_term, rented_at, due_at, returned_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .order("status", { ascending: true })
    .order("rented_at", { ascending: false })
    .limit(100);

  if (list.error) {
    if (isLockerTableMissing(list.error.message)) {
      return NextResponse.json({
        items: [],
        warning: "lockers table missing. Running in fallback mode with empty locker list.",
      });
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
      .select("id, locker_code, member_id, member_code, renter_name, phone, deposit_amount, note, status, rental_term, rented_at, due_at, returned_at")
      .maybeSingle();

    if (updateResult.error) {
      if (isLockerTableMissing(updateResult.error.message)) {
        return NextResponse.json({
          item: {
            id: rentalId,
            lockerCode: "",
            memberId: null,
            memberCode: "",
            renterName: "",
            phone: "",
            depositAmount: 0,
            note: "",
            status: "returned",
            rentalTerm: "daily",
            rentedAt: null,
            dueAt: null,
            returnedAt: updatedAt,
          },
          warning: "lockers table missing. Fallback mode: write skipped.",
        });
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
  const memberCodeInput = normalizeMemberCode(body?.memberId);
  const renterName = typeof body?.renterName === "string" ? body.renterName.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const depositAmount = parseAmount(body?.depositAmount ?? 0);
  const rentalTerm = parseRentalTerm(body?.rentalTerm);
  const explicitDueAt = parseIso(body?.dueAt);
  const dueAt = rentalTerm === "custom" ? explicitDueAt : (rentalTerm ? calcDueAtByTerm(rentalTerm) : null);
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (!lockerCode) {
    return NextResponse.json({ error: "lockerCode is required" }, { status: 400 });
  }
  if (lockerCode.length > 32) {
    return NextResponse.json({ error: "lockerCode too long" }, { status: 400 });
  }
  if (memberCodeInput) {
    if (!MEMBER_CODE_RE.test(memberCodeInput)) {
      return NextResponse.json({ error: "Invalid memberId format. Use 1-9999." }, { status: 400 });
    }
    const memberCodeNum = Number(memberCodeInput);
    if (!Number.isInteger(memberCodeNum) || memberCodeNum < 1 || memberCodeNum > 9999) {
      return NextResponse.json({ error: "Invalid memberId format. Use 1-9999." }, { status: 400 });
    }
  }
  if (!memberCodeInput && !renterName && !phone) {
    return NextResponse.json({ error: "memberId, renterName, or phone is required" }, { status: 400 });
  }
  if (!Number.isFinite(depositAmount) || depositAmount < 0) {
    return NextResponse.json({ error: "Invalid depositAmount" }, { status: 400 });
  }
  if (!rentalTerm) {
    return NextResponse.json({ error: "Invalid rentalTerm" }, { status: 400 });
  }
  if (rentalTerm === "custom" && !dueAt) {
    return NextResponse.json({ error: "dueAt is required for custom rentalTerm" }, { status: 400 });
  }
  if (typeof body?.dueAt === "string" && body.dueAt.trim() && !explicitDueAt) {
    return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
  }

  let memberId: string | null = null;
  let memberCode: string | null = null;
  if (memberCodeInput) {
    const normalizedCode = String(Number(memberCodeInput));
    const candidates = Array.from(new Set([memberCodeInput, normalizedCode]));
    const memberResult = await auth.supabase
      .from("members")
      .select("id, member_code")
      .eq("tenant_id", auth.context.tenantId)
      .in("member_code", candidates)
      .limit(1)
      .maybeSingle();

    if (memberResult.error) {
      return NextResponse.json({ error: memberResult.error.message }, { status: 500 });
    }
    if (!memberResult.data || !memberResult.data.id) {
      return NextResponse.json({ error: "Member not found by memberId" }, { status: 404 });
    }

    memberId = String(memberResult.data.id);
    memberCode = memberResult.data.member_code ? String(memberResult.data.member_code) : normalizedCode;
  }

  const updatedAt = new Date().toISOString();

  const existingActive = await auth.supabase
    .from("frontdesk_locker_rentals")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .eq("locker_code", lockerCode)
    .eq("status", "active")
    .maybeSingle();

  if (existingActive.error) {
    if (isLockerTableMissing(existingActive.error.message)) {
      return NextResponse.json({
        item: {
          id: `fallback-${crypto.randomUUID()}`,
          lockerCode,
          memberId,
          memberCode: memberCode || memberCodeInput,
          renterName,
          phone,
          depositAmount,
          note,
          status: "active",
          rentalTerm,
          rentedAt: updatedAt,
          dueAt,
          returnedAt: null,
        },
        warning: "lockers table missing. Fallback mode: write skipped.",
      }, { status: 201 });
    }
    return NextResponse.json({ error: existingActive.error.message }, { status: 500 });
  }
  if (existingActive.data) {
    return NextResponse.json({ error: "Locker is already in use" }, { status: 409 });
  }

  const insertResult = await auth.supabase
    .from("frontdesk_locker_rentals")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      locker_code: lockerCode,
      member_id: memberId || null,
      member_code: memberCode || null,
      renter_name: renterName || null,
      phone: phone || null,
      deposit_amount: depositAmount,
      note: note || null,
      status: "active",
      rental_term: rentalTerm,
      rented_by: auth.context.userId,
      due_at: dueAt,
      updated_at: updatedAt,
    })
    .select("id, locker_code, member_id, member_code, renter_name, phone, deposit_amount, note, status, rental_term, rented_at, due_at, returned_at")
    .maybeSingle();

  if (insertResult.error) {
    if (isLockerTableMissing(insertResult.error.message)) {
      return NextResponse.json({
        item: {
          id: `fallback-${crypto.randomUUID()}`,
          lockerCode,
          memberId,
          memberCode: memberCode || memberCodeInput,
          renterName,
          phone,
          depositAmount,
          note,
          status: "active",
          rentalTerm,
          rentedAt: updatedAt,
          dueAt,
          returnedAt: null,
        },
        warning: "lockers table missing. Fallback mode: write skipped.",
      }, { status: 201 });
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
      memberCode: memberCode || null,
      renterName: renterName || null,
      phone: phone || null,
      depositAmount,
      rentalTerm,
      dueAt,
    },
  });

  return NextResponse.json({ item: rowToItem(insertResult.data) }, { status: 201 });
}
