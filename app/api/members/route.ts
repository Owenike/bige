import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";

type CustomFields = Record<string, string>;

function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}

function parseCustomFields(input: unknown): CustomFields {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const parsed: CustomFields = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const k = key.trim();
    const v = typeof value === "string" ? value.trim() : "";
    if (!k || !v) continue;
    parsed[k] = v;
  }
  return parsed;
}

function encodeLegacyNotes(customFields: CustomFields) {
  if (Object.keys(customFields).length === 0) return null;
  return JSON.stringify({ customFields });
}

function decodeLegacyNotes(input: string | null): CustomFields {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input) as { customFields?: Record<string, unknown> };
    const source = parsed?.customFields;
    if (!source || typeof source !== "object") return {};
    const out: CustomFields = {};
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== "string") continue;
      const k = key.trim();
      const v = value.trim();
      if (!k || !v) continue;
      out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function parseDateInput(input: unknown) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();

  let query = auth.supabase
    .from("members")
    .select(
      [
        "id",
        "full_name",
        "phone",
        "email",
        "photo_url",
        "store_id",
        "tenant_id",
        "status",
        "birth_date",
        "member_code",
        "custom_fields",
        "notes",
      ].join(", "),
    )
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,member_code.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = ((data || []) as Array<{
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    photo_url: string | null;
    store_id: string | null;
    tenant_id: string;
    status: string | null;
    birth_date: string | null;
    member_code: string | null;
    custom_fields: unknown;
    notes: string | null;
  }>).map((item) => {
    const customFieldsFromColumn =
      item.custom_fields && typeof item.custom_fields === "object" && !Array.isArray(item.custom_fields)
        ? parseCustomFields(item.custom_fields)
        : {};
    const customFields = Object.keys(customFieldsFromColumn).length > 0 ? customFieldsFromColumn : decodeLegacyNotes(item.notes);
    return {
      ...item,
      custom_fields: customFields,
    };
  });

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const rawPhone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
  const birthDate = parseDateInput(body?.birthDate);
  const gender = typeof body?.gender === "string" ? body.gender.trim() : null;
  const address = typeof body?.address === "string" ? body.address.trim() : null;
  const emergencyName = typeof body?.emergencyName === "string" ? body.emergencyName.trim() : null;
  const emergencyPhoneRaw = typeof body?.emergencyPhone === "string" ? body.emergencyPhone.trim() : "";
  const emergencyPhone = emergencyPhoneRaw ? normalizePhone(emergencyPhoneRaw) : null;
  const leadSource = typeof body?.leadSource === "string" ? body.leadSource.trim() : null;
  const salesOwner = typeof body?.salesOwner === "string" ? body.salesOwner.trim() : null;
  const marketingSmsOptIn = Boolean(body?.marketingSmsOptIn);
  const marketingEmailOptIn = Boolean(body?.marketingEmailOptIn);
  const marketingLineOptIn = Boolean(body?.marketingLineOptIn);
  const marketingConsentedAt = marketingSmsOptIn || marketingEmailOptIn || marketingLineOptIn ? new Date().toISOString() : null;
  const contractAgreed = Boolean(body?.contractAgreed);
  const privacyAgreed = Boolean(body?.privacyAgreed);
  const waiverAgreed = Boolean(body?.waiverAgreed);
  const healthNote = typeof body?.healthNote === "string" ? body.healthNote.trim() : null;
  const guardianName = typeof body?.guardianName === "string" ? body.guardianName.trim() : null;
  const guardianPhoneRaw = typeof body?.guardianPhone === "string" ? body.guardianPhone.trim() : "";
  const guardianPhone = guardianPhoneRaw ? normalizePhone(guardianPhoneRaw) : null;
  const storeId = typeof body?.storeId === "string" ? body.storeId : auth.context.branchId;
  const customFields = parseCustomFields(body?.customFields);
  const legacyNotes = encodeLegacyNotes(customFields);

  if (!fullName || !auth.context.tenantId) {
    return NextResponse.json({ error: "Missing fullName or tenant context" }, { status: 400 });
  }
  if (!phone || phone.length < 8) {
    return NextResponse.json({ error: "Phone is required and must be valid" }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  const duplicatePhoneQuery = await auth.supabase
    .from("members")
    .select("id, full_name, phone, email, store_id, custom_fields")
    .eq("tenant_id", auth.context.tenantId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();
  if (duplicatePhoneQuery.error) {
    return NextResponse.json({ error: duplicatePhoneQuery.error.message }, { status: 500 });
  }
  if (duplicatePhoneQuery.data) {
    return NextResponse.json({ error: "Duplicate phone", existingMember: duplicatePhoneQuery.data }, { status: 409 });
  }

  if (email) {
    const duplicateEmailQuery = await auth.supabase
      .from("members")
      .select("id, full_name, phone, email, store_id, custom_fields")
      .eq("tenant_id", auth.context.tenantId)
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    if (duplicateEmailQuery.error) {
      return NextResponse.json({ error: duplicateEmailQuery.error.message }, { status: 500 });
    }
    if (duplicateEmailQuery.data) {
      return NextResponse.json({ error: "Duplicate email", existingMember: duplicateEmailQuery.data }, { status: 409 });
    }
  }

  const { data, error } = await auth.supabase
    .from("members")
    .insert({
      tenant_id: auth.context.tenantId,
      store_id: storeId,
      full_name: fullName,
      phone,
      email,
      birth_date: birthDate,
      gender: gender || null,
      address: address || null,
      emergency_contact_name: emergencyName || null,
      emergency_contact_phone: emergencyPhone || null,
      lead_source: leadSource || null,
      sales_owner: salesOwner || null,
      marketing_sms_opt_in: marketingSmsOptIn,
      marketing_email_opt_in: marketingEmailOptIn,
      marketing_line_opt_in: marketingLineOptIn,
      marketing_consented_at: marketingConsentedAt,
      contract_agreed: contractAgreed,
      privacy_agreed: privacyAgreed,
      waiver_agreed: waiverAgreed,
      health_note: healthNote || null,
      guardian_name: guardianName || null,
      guardian_phone: guardianPhone || null,
      custom_fields: customFields,
      notes: legacyNotes,
    })
    .select("id, full_name, phone, email, store_id, custom_fields, notes")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const customFieldsFromColumn =
    data?.custom_fields && typeof data.custom_fields === "object" && !Array.isArray(data.custom_fields)
      ? parseCustomFields(data.custom_fields)
      : {};

  return NextResponse.json(
    {
      member: data
        ? {
            ...data,
            custom_fields:
              Object.keys(customFieldsFromColumn).length > 0
                ? customFieldsFromColumn
                : decodeLegacyNotes((data as { notes: string | null }).notes),
          }
        : null,
    },
    { status: 201 },
  );
}
