import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

type CustomFields = Record<string, string>;

function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}

function parseDateInput(input: unknown) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function parseCustomFields(input: unknown): CustomFields {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: CustomFields = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const nextKey = key.trim();
    const nextValue = typeof value === "string" ? value.trim() : "";
    if (!nextKey || !nextValue) continue;
    output[nextKey] = nextValue;
  }
  return output;
}

function encodeLegacyNotes(customFields: CustomFields) {
  if (Object.keys(customFields).length === 0) return null;
  return JSON.stringify({ customFields });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const hasFullName = Object.prototype.hasOwnProperty.call(body, "fullName");
  const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
  const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");
  const hasBirthDate = Object.prototype.hasOwnProperty.call(body, "birthDate");
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  const hasCustomFields = Object.prototype.hasOwnProperty.call(body, "customFields");

  if (!hasFullName && !hasPhone && !hasEmail && !hasBirthDate && !hasStatus && !hasCustomFields) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const parsedBirthDate = hasBirthDate ? parseDateInput(body.birthDate) : null;
  const rawStatus = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  const nextCustomFields = hasCustomFields ? parseCustomFields(body.customFields) : null;

  if (hasFullName && !fullName) {
    return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  }
  if (hasPhone && phone && phone.length < 8) {
    return NextResponse.json({ error: "Phone is invalid" }, { status: 400 });
  }
  if (hasEmail && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }
  if (hasBirthDate && body.birthDate && !parsedBirthDate) {
    return NextResponse.json({ error: "Invalid birth date format" }, { status: 400 });
  }
  if (hasStatus && rawStatus && !["active", "inactive", "suspended"].includes(rawStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id, phone, email")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (memberResult.error) return NextResponse.json({ error: memberResult.error.message }, { status: 500 });
  if (!memberResult.data) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  if (
    auth.context.role === "frontdesk" &&
    auth.context.branchId &&
    memberResult.data.store_id &&
    String(memberResult.data.store_id) !== auth.context.branchId
  ) {
    return NextResponse.json({ error: "Forbidden member access for current branch" }, { status: 403 });
  }

  if (hasPhone && phone && phone !== normalizePhone(memberResult.data.phone || "")) {
    const duplicatePhoneResult = await auth.supabase
      .from("members")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("phone", phone)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (duplicatePhoneResult.error) {
      return NextResponse.json({ error: duplicatePhoneResult.error.message }, { status: 500 });
    }
    if (duplicatePhoneResult.data) {
      return NextResponse.json({ error: "Duplicate phone" }, { status: 409 });
    }
  }

  if (hasEmail && email && email !== String(memberResult.data.email || "").trim().toLowerCase()) {
    const duplicateEmailResult = await auth.supabase
      .from("members")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("email", email)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (duplicateEmailResult.error) {
      return NextResponse.json({ error: duplicateEmailResult.error.message }, { status: 500 });
    }
    if (duplicateEmailResult.data) {
      return NextResponse.json({ error: "Duplicate email" }, { status: 409 });
    }
  }

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (hasFullName) updatePayload.full_name = fullName;
  if (hasPhone) updatePayload.phone = phone || null;
  if (hasEmail) updatePayload.email = email || null;
  if (hasBirthDate) updatePayload.birth_date = parsedBirthDate;
  if (hasStatus) updatePayload.status = rawStatus || "active";
  if (hasCustomFields && nextCustomFields) {
    updatePayload.custom_fields = nextCustomFields;
    updatePayload.notes = encodeLegacyNotes(nextCustomFields);
  }

  const updateResult = await auth.supabase
    .from("members")
    .update(updatePayload)
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .select("id, full_name, phone, email, status, birth_date, member_code, custom_fields")
    .maybeSingle();

  if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  if (!updateResult.data) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "member_update_frontdesk",
    target_type: "member",
    target_id: id,
    reason: "member_inline_edit",
    payload: updatePayload,
  });

  return NextResponse.json({ member: updateResult.data });
}

