import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "../../../../lib/auth-context";

const BodySchema = z
  .object({
    full_name: z.string().optional(),
    phone: z.string().optional(),
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
  photo_url: string | null;
  notes: string | null;
  consent_status: string | null;
  consent_signed_at: string | null;
  auth_user_id: string;
};

function normalizeOptionalText(input: string): string | null {
  const trimmed = input.trim();
  return trimmed ? trimmed : null;
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
      "id, tenant_id, store_id, full_name, phone, photo_url, notes, consent_status, consent_signed_at, auth_user_id",
    )
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const body = parsed.data;
  const update: Partial<
    Pick<MemberRow, "full_name" | "phone" | "photo_url" | "notes" | "consent_status" | "consent_signed_at">
  > = {};

  if (Object.prototype.hasOwnProperty.call(body, "full_name")) {
    update.full_name = normalizeOptionalText(body.full_name ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(body, "phone")) {
    update.phone = normalizeOptionalText(body.phone ?? "");
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

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ member: memberResult.data });
  }

  const updatedResult = await supabase
    .from("members")
    .update(update)
    .eq("auth_user_id", userId)
    .select(
      "id, tenant_id, store_id, full_name, phone, photo_url, notes, consent_status, consent_signed_at, auth_user_id",
    )
    .maybeSingle();

  if (updatedResult.error || !updatedResult.data) {
    return NextResponse.json({ error: updatedResult.error?.message || "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ member: updatedResult.data });
}
