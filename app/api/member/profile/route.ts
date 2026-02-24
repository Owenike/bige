import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const BodySchema = z
  .object({
    full_name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    emergency_contact_name: z.string().optional(),
    emergency_contact_phone: z.string().optional(),
    photo_url: z.string().optional(),
    notes: z.string().optional(),
    consent_agree: z.boolean().optional(),
  })
  .strict();

type MemberRow = {
  id: string;
  tenant_id: string | null;
  store_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  photo_url: string | null;
  notes: string | null;
  consent_status: string | null;
  consent_signed_at: string | null;
  portal_status: string | null;
  auth_user_id: string;
};

function normalizeOptionalText(input: string): string | null {
  const trimmed = input.trim();
  return trimmed ? trimmed : null;
}

function normalizePhone(input: string | null) {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  return digits || null;
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;
  const userId = auth.context.userId;

  const raw: unknown = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Ensure this user actually has a member row (and to provide clearer errors).
  const memberResult = await supabase
    .from("members")
    .select(
      [
        "id",
        "tenant_id",
        "store_id",
        "full_name",
        "phone",
        "email",
        "address",
        "emergency_contact_name",
        "emergency_contact_phone",
        "photo_url",
        "notes",
        "consent_status",
        "consent_signed_at",
        "portal_status",
        "auth_user_id",
      ].join(", "),
    )
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const body = parsed.data;
  const update: Partial<
    Pick<
      MemberRow,
      | "full_name"
      | "phone"
      | "email"
      | "address"
      | "emergency_contact_name"
      | "emergency_contact_phone"
      | "photo_url"
      | "notes"
      | "consent_status"
      | "consent_signed_at"
    >
  > = {};

  if (Object.prototype.hasOwnProperty.call(body, "full_name")) {
    update.full_name = normalizeOptionalText(body.full_name ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(body, "phone")) {
    update.phone = normalizePhone(normalizeOptionalText(body.phone ?? ""));
  }
  if (Object.prototype.hasOwnProperty.call(body, "email")) {
    update.email = normalizeOptionalText(body.email ?? "")?.toLowerCase() || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "address")) {
    update.address = normalizeOptionalText(body.address ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(body, "emergency_contact_name")) {
    update.emergency_contact_name = normalizeOptionalText(body.emergency_contact_name ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(body, "emergency_contact_phone")) {
    update.emergency_contact_phone = normalizePhone(normalizeOptionalText(body.emergency_contact_phone ?? ""));
  }
  if (Object.prototype.hasOwnProperty.call(body, "photo_url")) {
    update.photo_url = normalizeOptionalText(body.photo_url ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    // Notes might be intentionally blank; treat whitespace-only as null.
    update.notes = normalizeOptionalText(body.notes ?? "");
  }

  if (body.consent_agree === true) {
    update.consent_status = "agreed";
    update.consent_signed_at = new Date().toISOString();
  }

  if (update.phone && update.phone.length < 8) {
    return NextResponse.json({ error: "Phone is invalid" }, { status: 400 });
  }

  if (update.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  if (memberResult.data.tenant_id) {
    if (update.phone && update.phone !== memberResult.data.phone) {
      const duplicatePhoneResult = await supabase
        .from("members")
        .select("id")
        .eq("tenant_id", memberResult.data.tenant_id)
        .eq("phone", update.phone)
        .neq("id", memberResult.data.id)
        .limit(1)
        .maybeSingle();
      if (duplicatePhoneResult.error) {
        return NextResponse.json({ error: duplicatePhoneResult.error.message }, { status: 500 });
      }
      if (duplicatePhoneResult.data) {
        return NextResponse.json({ error: "Duplicate phone" }, { status: 409 });
      }
    }

    if (update.email && update.email !== (memberResult.data.email || "").toLowerCase()) {
      const duplicateEmailResult = await supabase
        .from("members")
        .select("id")
        .eq("tenant_id", memberResult.data.tenant_id)
        .eq("email", update.email)
        .neq("id", memberResult.data.id)
        .limit(1)
        .maybeSingle();
      if (duplicateEmailResult.error) {
        return NextResponse.json({ error: duplicateEmailResult.error.message }, { status: 500 });
      }
      if (duplicateEmailResult.data) {
        return NextResponse.json({ error: "Duplicate email" }, { status: 409 });
      }
    }
  }

  if (memberResult.data.auth_user_id && update.email && update.email !== (memberResult.data.email || "").toLowerCase()) {
    const admin = createSupabaseAdminClient();
    const authUpdateResult = await admin.auth.admin.updateUserById(memberResult.data.auth_user_id, {
      email: update.email,
      email_confirm: true,
    });
    if (authUpdateResult.error) {
      return NextResponse.json({ error: authUpdateResult.error.message }, { status: 500 });
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ member: memberResult.data });
  }

  const updatedResult = await supabase
    .from("members")
    .update(update)
    .eq("auth_user_id", userId)
    .select(
      [
        "id",
        "tenant_id",
        "store_id",
        "full_name",
        "phone",
        "email",
        "address",
        "emergency_contact_name",
        "emergency_contact_phone",
        "photo_url",
        "notes",
        "consent_status",
        "consent_signed_at",
        "portal_status",
        "auth_user_id",
      ].join(", "),
    )
    .maybeSingle();

  if (updatedResult.error || !updatedResult.data) {
    return NextResponse.json({ error: updatedResult.error?.message || "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ member: updatedResult.data });
}
