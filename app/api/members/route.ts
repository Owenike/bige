import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";

type CustomFields = Record<string, string>;

function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}

function parseCustomFields(input: unknown): CustomFields {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const rows = Object.entries(input as Record<string, unknown>);
  const parsed: CustomFields = {};
  for (const [key, value] of rows) {
    const k = key.trim();
    const v = typeof value === "string" ? value.trim() : "";
    if (!k || !v) continue;
    parsed[k] = v;
  }
  return parsed;
}

function encodeMemberNotes(customFields: CustomFields) {
  if (Object.keys(customFields).length === 0) return null;
  return JSON.stringify({ customFields });
}

function decodeMemberNotes(input: string | null): CustomFields {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input) as { customFields?: Record<string, unknown> };
    if (!parsed || typeof parsed !== "object" || !parsed.customFields || typeof parsed.customFields !== "object") {
      return {};
    }
    const fields: CustomFields = {};
    for (const [key, value] of Object.entries(parsed.customFields)) {
      if (typeof value !== "string") continue;
      const k = key.trim();
      const v = value.trim();
      if (!k || !v) continue;
      fields[k] = v;
    }
    return fields;
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();

  let query = auth.supabase
    .from("members")
    .select("id, full_name, phone, photo_url, store_id, tenant_id, notes")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = ((data || []) as Array<{
    id: string;
    full_name: string;
    phone: string | null;
    photo_url: string | null;
    store_id: string | null;
    tenant_id: string;
    notes: string | null;
  }>).map((item) => ({
    ...item,
    custom_fields: decodeMemberNotes(item.notes),
  }));

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const rawPhone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const storeId = typeof body?.storeId === "string" ? body.storeId : auth.context.branchId;
  const customFields = parseCustomFields(body?.customFields);
  const notes = encodeMemberNotes(customFields);

  if (!fullName || !auth.context.tenantId) {
    return NextResponse.json({ error: "Missing fullName or tenant context" }, { status: 400 });
  }
  if (phone && phone.length < 8) {
    return NextResponse.json({ error: "Phone format invalid" }, { status: 400 });
  }

  if (phone) {
    const duplicatePhoneQuery = await auth.supabase
      .from("members")
      .select("id, full_name, phone, store_id")
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
  }

  if (phone) {
    const duplicateMemberQuery = await auth.supabase
      .from("members")
      .select("id, full_name, phone, store_id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("full_name", fullName)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();
    if (duplicateMemberQuery.error) {
      return NextResponse.json({ error: duplicateMemberQuery.error.message }, { status: 500 });
    }
    if (duplicateMemberQuery.data) {
      return NextResponse.json({ error: "Duplicate member", existingMember: duplicateMemberQuery.data }, { status: 409 });
    }
  }

  const { data, error } = await auth.supabase
    .from("members")
    .insert({
      tenant_id: auth.context.tenantId,
      store_id: storeId,
      full_name: fullName,
      phone,
      notes,
    })
    .select("id, full_name, phone, store_id, notes")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    member: data
      ? {
          ...data,
          custom_fields: decodeMemberNotes((data as { notes: string | null }).notes),
        }
      : null,
  }, { status: 201 });
}
