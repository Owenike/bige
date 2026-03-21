import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { resolveBranchTherapists } from "../../../lib/therapist-scheduling";

function normalizeCoachLabel(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emailLabelFromAddress(email: string | null | undefined) {
  const normalized = normalizeCoachLabel(email);
  if (!normalized) return null;
  const [localPart] = normalized.split("@");
  return normalizeCoachLabel(localPart) || normalized;
}

async function loadEmailsByIds(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return new Map<string, string>();
  }

  const pending = new Set(userIds);
  const emailById = new Map<string, string>();
  let page = 1;
  const perPage = 200;

  while (page <= 8 && pending.size > 0) {
    const usersResult = await admin.auth.admin.listUsers({ page, perPage });
    if (usersResult.error) break;
    const users = usersResult.data.users || [];
    if (users.length === 0) break;
    for (const user of users) {
      if (!pending.has(user.id)) continue;
      emailById.set(user.id, user.email || "");
      pending.delete(user.id);
    }
    if (users.length < perPage) break;
    page += 1;
  }

  return emailById;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk", "coach", "member"], request);
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;
  const tenantId = auth.context.tenantId;
  if (!tenantId) return NextResponse.json({ items: [] });
  try {
    const items = await resolveBranchTherapists({
      supabase,
      tenantId,
      branchId: auth.context.branchId,
    });
    const emailById = await loadEmailsByIds(items.map((row) => row.id));
    return NextResponse.json({
      items: items.map((row) => ({
        id: row.id,
        displayName:
          normalizeCoachLabel(row.displayName) ||
          emailLabelFromAddress(emailById.get(row.id)) ||
          row.id.slice(0, 8),
        branchId: row.primaryBranchId,
        branchIds: row.branchIds,
        role: row.role,
        isActive: row.isActive,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load therapists" }, { status: 500 });
  }
}
